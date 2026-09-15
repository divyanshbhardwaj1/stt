"""FastAPI app: upload a recording, watch it process, download the report."""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import BackgroundTasks, Depends, FastAPI, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from services.config import ConfigError, Settings
from services.audit import SettleError, audit_grid
from services.playback import cues
from services.timing import TimingError, word_index
from services.csv_filler import load_json
from services.style_set import StyleSetNotFound, align, find_style_set, list_style_numbers
from services.transcript import (
    AUDIO_SUFFIXES,
    DOMAIN_PROMPT,
    LANGUAGES,
    live_transcript_path_for,
)
from services.transcript.transcription_service import MAX_UPLOAD_BYTES

from pipeline import resize_inspection, settle_inspection

from .jobs import DONE, DOWNLOADS, JobStore, apply_result, process, process_transcript

log = logging.getLogger(__name__)

# The React app, built by `npm run build` in src/frontend. Gitignored, so a
# checkout that has never run npm serves the legacy single-file page instead
# and the app still works with a Python-only toolchain.
FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"
LEGACY_PAGE = Path(__file__).parent / "index.html"
CHUNK = 1024 * 1024

# The transcription API caps a single upload at MAX_UPLOAD_BYTES, but the
# pipeline re-encodes anything larger to 16 kHz mono before sending it, so the
# browser must not refuse a recording the pipeline could handle. This ceiling
# exists only to stop a runaway upload filling the disk; a half-hour inspection
# lands well under it even at phone-default quality.
MAX_RECORDING_BYTES = 500 * 1024 * 1024

app = FastAPI(title="Size Set Inspection Reports", docs_url="/api/docs")
store = JobStore()

# Vite emits hashed bundles under dist/assets and references them absolutely.
# Mounted at import, so a build made while the server is running needs a
# restart (or --reload) to be served.
if (FRONTEND_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Resolved settings, read once. Tests override this dependency."""
    return Settings.load()


def settings_dependency() -> Settings:
    try:
        return get_settings()
    except ConfigError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# Annotated form rather than a Depends() default, which lint rightly flags as a
# call evaluated at import time.
SettingsDep = Annotated[Settings, Depends(settings_dependency)]


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    """The app shell, read from disk each time and never cached.

    Prefers the built React app; falls back to the legacy single-file page when
    src/frontend has not been built. Without no-store the browser serves a
    stale shell after a rebuild, which looks exactly like the change not
    working — the hashed asset filenames handle caching for everything else.
    """
    built = FRONTEND_DIST / "index.html"
    page = built if built.is_file() else LEGACY_PAGE
    return HTMLResponse(
        page.read_text(encoding="utf-8"),
        headers={"Cache-Control": "no-store, must-revalidate"},
    )


@app.get("/api/style-sets")
def list_style_sets(settings: SettingsDep) -> list[str]:
    """Style numbers with a spec sheet on disk, for the upload dropdown."""
    return list_style_numbers(settings.style_sets_dir)


# How long the browser has to open its session with the minted credential. It
# only needs seconds; the session itself lives on past expiry, so a short window
# costs nothing and keeps a leaked token worthless.
REALTIME_TOKEN_TTL_SECONDS = 600

# The live monitor's prompt: the shared one, plus a nudge toward English
# spelling that deliberately names no script.
#
# gpt-live-transcribe mis-scripts its opening utterance - "small size" comes
# back as "स्मॉल साइज", and "size" has come back as the Japanese "サイズ". It is
# always the first second or two, before the model has heard enough to be sure
# what it is listening to; the body of a recording is clean. Four prompts, 8-16
# runs each, replaying one real inspection through the browser:
#
#                                        impossible script   English in Devanagari
#   shared prompt alone            n=16        1/16                 6/16
#   + "Hindi in Devanagari"        n=8         2/8                  2/8
#   no Hindi framing at all        n=8         3/8                  1/8
#   + "English spelling" (this)    n=16        2/16                 3/16
#
# Two things to read off that. Naming Devanagari made it worse, and dropping
# the Hindi framing let language ID wander into Cyrillic and Chinese - scripts
# nobody in the room is speaking - so the Hindi anchor earns its place and the
# fix had to avoid naming a script at all. And the win here is real but small:
# 5/16 bad runs against 7/16, p=0.72. Directional, not demonstrated. It is kept
# because the prompt is provably a live lever - the Devanagari wording moved
# the rate to 7/8 - and one sentence costs nothing.
#
# `languages` is not the lever: it is accepted and echoed back intact and still
# does not constrain the output, which is how Japanese got out in the first
# place. turn_detection is refused outright. Forcing singular `language` would
# cost the Hindi the floor actually speaks.
#
# DOMAIN_PROMPT itself is untouched. The batch passes build the report, never
# show this failure, and are verified as they stand.
LIVE_PROMPT = DOMAIN_PROMPT + " Write English words in English spelling."

# Line breaks are NOT configured here. `gpt-live-transcribe` refuses a
# turn_detection block outright ("Turn detection is not supported for this
# transcription model") and emits no ...transcription.completed events at all -
# measured against a real inspection: 44 deltas, 0 completions. It is a
# continuous captioner by design, so the browser segments the delta stream
# itself against its own level meter. See useLiveTranscript.ts.


@app.post("/api/realtime-token")
def realtime_token(settings: SettingsDep) -> dict[str, object]:
    """Mint a short-lived credential for live transcription in the browser.

    The account key never leaves this process. The browser gets a scoped,
    expiring secret and streams its microphone to the transcription API
    directly, which keeps a half-hour of audio off this server entirely.

    The session carries the batch prompt and languages, so the live monitor
    reads garment vocabulary rather than guessing at "one by eight". What it
    produces is never fed to the report: this model trades recall of exactly
    those short verdict words for latency, and mis-scripts its opening
    utterance often enough that LIVE_PROMPT exists to lean against it.
    """
    if not settings.realtime_model:
        raise HTTPException(
            status_code=503,
            detail="live transcription is off (SIZESET_REALTIME_MODEL is empty)",
        )

    from openai import OpenAI

    try:
        secret = OpenAI(api_key=settings.openai_api_key).realtime.client_secrets.create(
            expires_after={"anchor": "created_at", "seconds": REALTIME_TOKEN_TTL_SECONDS},
            session={
                "type": "transcription",
                "audio": {
                    "input": {
                        # Only model, prompt and languages survive here. The API
                        # accepts `keywords` and `delay` without complaint and
                        # then echoes both back as null - measured on the token
                        # itself and again on session.updated - so they are not
                        # sent: dead config that reads as a working vocabulary
                        # boost is worse than none. The batch passes, which do
                        # honour KEYWORDS, remain the report's source.
                        "transcription": {
                            "model": settings.realtime_model,
                            "prompt": LIVE_PROMPT,
                            "languages": list(LANGUAGES),
                        },
                    }
                },
            },
        )
    except Exception as exc:  # noqa: BLE001 - surface the upstream reason verbatim
        log.warning("could not mint a realtime token: %s", exc)
        raise HTTPException(status_code=502, detail=f"realtime session refused: {exc}") from exc

    return {"value": secret.value, "model": settings.realtime_model}


@app.get("/api/jobs")
def list_jobs() -> list[dict[str, object]]:
    return [job.as_dict() for job in store.all()]


@app.get("/api/jobs/{job_id}")
def read_job(job_id: str) -> dict[str, object]:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    return job.as_dict()


@app.post("/api/jobs", status_code=202)
async def create_job(
    background: BackgroundTasks,
    recording: UploadFile,
    settings: SettingsDep,
    style_no: Annotated[str, Form()] = "",
    live_transcript: Annotated[str, Form()] = "",
) -> dict[str, object]:
    """Accept a recording and queue it. Returns immediately with a job to poll.

    `style_no` is the style set to check against. Leave it empty to fall back to
    the style number announced at the start of the recording.

    `live_transcript` is what the browser's monitor heard while recording. It is
    saved beside the batch transcripts for audit and never read by the pipeline.
    """
    # The browser controls the filename, so keep only its last component and
    # check the suffix before anything touches the filesystem.
    name = Path(recording.filename or "").name
    suffix = Path(name).suffix.lower()
    if not name or suffix not in AUDIO_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail=f"unsupported file type {suffix or '(none)'}. "
            f"Use one of: {', '.join(sorted(AUDIO_SUFFIXES))}",
        )

    destination = _free_path(settings.recordings_dir, name)
    written = await _save(recording, destination)
    if written > MAX_RECORDING_BYTES:
        destination.unlink(missing_ok=True)
        raise HTTPException(
            status_code=413,
            detail=f"{name} is {written / 1e6:.0f} MB, over the "
            f"{MAX_RECORDING_BYTES / 1e6:.0f} MB upload limit. Split it into shorter parts.",
        )
    if written > MAX_UPLOAD_BYTES:
        log.info("%s is %.1f MB and will be re-encoded before transcription", name, written / 1e6)

    chosen = style_no.strip()
    if chosen and chosen not in list_style_numbers(settings.style_sets_dir):
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=404, detail=f"no style set for style {chosen}")

    # Written before the job is queued, not after: this is the only copy of what
    # the monitor heard, and it should survive a pipeline that fails on stage 1.
    if live_transcript.strip():
        saved = live_transcript_path_for(destination, settings)
        saved.parent.mkdir(parents=True, exist_ok=True)
        saved.write_text(live_transcript, encoding="utf-8")
        log.info("saved live transcript %s (%d chars)", saved.name, len(live_transcript))

    job = store.create(destination.name, style_no=chosen)
    background.add_task(process, job, destination, settings, store)
    log.info("queued job %s for %s (style %s)", job.id, destination.name, chosen or "as announced")
    return job.as_dict()


class TranscriptJobRequest(BaseModel):
    """An inspection that was transcribed elsewhere — a live meeting."""

    transcript: str
    style_no: str = ""
    # Names the saved transcript and the output files, so it must be
    # filesystem-safe. The caller owns that: only it knows whether the source
    # was a meeting id, a title, or something else. Sanitised again here
    # because a bad name would write outside the output directory.
    name: str = "inspection"


# NOT "/api/jobs/from-transcript": that path also matches the earlier
# `GET /api/jobs/{job_id}` route, and Starlette answers a path match with the
# wrong method as 405 rather than falling through to a later route. A distinct
# path is robust regardless of declaration order.
@app.post("/api/transcript-jobs", status_code=202)
def create_job_from_transcript(
    background: BackgroundTasks,
    request: TranscriptJobRequest,
    settings: SettingsDep,
) -> dict[str, object]:
    """Queue an inspection from transcript text instead of a recording.

    Everything after transcription is identical to the upload path, so the
    report is the same regardless of how the audio reached us.
    """
    text = request.transcript.strip()
    if not text:
        raise HTTPException(status_code=422, detail="transcript is empty")

    chosen = request.style_no.strip()
    if chosen and chosen not in list_style_numbers(settings.style_sets_dir):
        raise HTTPException(status_code=404, detail=f"no style set for style {chosen}")

    name = _safe_name(request.name)
    job = store.create(f"{name}.txt", style_no=chosen)
    background.add_task(process_transcript, job, text, name, settings, store)
    log.info(
        "queued transcript job %s as %s (%d chars, style %s)",
        job.id,
        name,
        len(text),
        chosen or "as announced",
    )
    return job.as_dict()


def _safe_name(name: str) -> str:
    """A filesystem-safe stem.

    Meeting titles arrive here, and they carry slashes, quotes and emoji. Only
    the last path component is kept and only safe characters survive, so a
    crafted name cannot escape `transcripts_dir` or `output_dir`.
    """
    stem = Path(name or "").name
    cleaned = "".join(c if (c.isalnum() or c in " -_()") else "-" for c in stem).strip()
    return (cleaned or "inspection")[:80]


def _graded_sheet(job, settings: Settings):
    """The saved extraction and the style set it was judged against."""
    if job.status != DONE:
        raise HTTPException(status_code=409, detail=f"job is {job.status}, not ready")
    if not job.graded:
        raise HTTPException(
            status_code=409,
            detail=(
                "this inspection was never checked against a spec sheet, so there is no "
                "graded sheet to audit. Process it again with a style selected."
            ),
        )
    saved = settings.output_dir / f"{job.name}.json"
    if not saved.is_file():
        raise HTTPException(status_code=410, detail=f"{saved.name} is no longer on disk")
    sheet = load_json(saved)
    try:
        style = find_style_set(job.graded_style_no, settings.style_sets_dir)
    except StyleSetNotFound as exc:
        raise HTTPException(status_code=410, detail=str(exc)) from exc
    return sheet, style


@app.get("/api/jobs/{job_id}/sheet")
def graded_sheet(job_id: str, settings: SettingsDep) -> dict[str, object]:
    """The whole graded sheet as a grid, for the audit view.

    Every point of measure the client's sheet prints, one cell per size - the
    same shape as the graded PDF, so screen and paper cannot drift apart.
    """
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    sheet, style = _graded_sheet(job, settings)
    return audit_grid(align(sheet, style), style, sheet)


@app.post("/api/jobs/{job_id}/sheet")
def settle_sheet(job_id: str, body: dict, settings: SettingsDep) -> dict[str, object]:
    """Apply an operator's corrections and rebuild every output from them.

    No transcription and no model call: the extraction is the source of truth
    for everything downstream, so settling a cell is an edit and a re-render.
    That is also what recomputes the verdict, which is the point - filling in
    the last unanswered point of measure is what releases the report.
    """
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    _graded_sheet(job, settings)  # same guards, before anything is written

    edits = body.get("edits") or []
    if not isinstance(edits, list) or not edits:
        raise HTTPException(status_code=400, detail="no edits were sent")
    for edit in edits:
        if not isinstance(edit, dict) or "sheet_index" not in edit or "size" not in edit:
            raise HTTPException(
                status_code=400, detail="every edit needs a sheet_index and a size"
            )

    try:
        result, misplaced = settle_inspection(
            job.name, edits, settings, style_no=job.graded_style_no
        )
    except (SettleError, FileNotFoundError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    apply_result(job, result)
    sheet, style = _graded_sheet(job, settings)
    return {
        "job": job.as_dict(),
        "sheet": audit_grid(align(sheet, style), style, sheet),
        # Cells that did not align back onto the point of measure they were
        # entered against. Reported, never swallowed: a reading filed against
        # the wrong row is exactly the silent corruption this tool exists to
        # prevent, and the operator has to be told rather than reassured.
        "misplaced": [{"sheet_index": index, "size": size} for index, size in misplaced],
    }


@app.post("/api/jobs/{job_id}/size")
def regrade(job_id: str, body: dict, settings: SettingsDep) -> dict[str, object]:
    """Re-file this inspection's readings against a different size column.

    The one correction that changes every row at once. Offered because the
    recording usually does not say the size, so the grading falls back to the
    sheet's base size and is wrong for any other garment on the table.
    """
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    _graded_sheet(job, settings)

    from_size, to_size = str(body.get("from", "")), str(body.get("to", ""))
    if not from_size or not to_size:
        raise HTTPException(status_code=400, detail="both a from and a to size are needed")

    try:
        result = resize_inspection(
            job.name, from_size, to_size, settings, style_no=job.graded_style_no
        )
    except (SettleError, FileNotFoundError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    apply_result(job, result)
    sheet, style = _graded_sheet(job, settings)
    return {"job": job.as_dict(), "sheet": audit_grid(align(sheet, style), style, sheet)}


@app.get("/api/jobs/{job_id}/audio")
def recording_audio(job_id: str, settings: SettingsDep) -> FileResponse:
    """The inspection recording itself, so a reading can be listened back to.

    Served whole rather than sliced: Starlette answers Range requests, so the
    browser fetches only the seconds it plays. Cutting clips server-side would
    mean writing and cleaning up a file per cell for no gain.
    """
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    path = settings.recordings_dir / job.filename
    if not path.is_file():
        raise HTTPException(
            status_code=410, detail=f"{job.filename} is no longer in the recordings folder"
        )
    return FileResponse(path, filename=path.name)


@app.get("/api/jobs/{job_id}/cues")
def playback_cues(job_id: str, settings: SettingsDep) -> dict[str, object]:
    """Where each reading sits in the recording.

    Built on first ask and cached beside the transcripts, because most
    inspections are never listened back to and indexing every one of them would
    be paying for a feature nobody used.
    """
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    sheet, style = _graded_sheet(job, settings)
    recording = settings.recordings_dir / job.filename
    try:
        index = word_index(recording, settings)
    except TimingError as exc:
        # 409, not 500: nothing is broken. Either no key is configured or this
        # recording cannot be indexed, and both are for a person to settle.
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    found = cues(align(sheet, style), index)
    return {
        "duration": index.duration,
        "cues": {
            str(number): {"start": round(cue.start, 2), "end": round(cue.end, 2), "exact": cue.exact}
            for number, cue in found.items()
        },
    }


@app.get("/api/jobs/{job_id}/download/{kind}")
def download(job_id: str, kind: str) -> FileResponse:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    if job.status != DONE:
        raise HTTPException(status_code=409, detail=f"job is {job.status}, not ready")
    if kind not in DOWNLOADS or kind not in job.files:
        raise HTTPException(status_code=404, detail=f"no {kind!r} output for this job")

    path = job.files[kind]
    if not path.is_file():
        raise HTTPException(status_code=410, detail=f"{path.name} is no longer on disk")
    return FileResponse(path, media_type=DOWNLOADS[kind][1], filename=path.name)


async def _save(upload: UploadFile, destination: Path) -> int:
    """Stream the upload to disk, returning the byte count.

    Streamed rather than read whole: recordings run to tens of megabytes and
    there is no reason to hold one in memory.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with destination.open("wb") as handle:
        while chunk := await upload.read(CHUNK):
            written += len(chunk)
            handle.write(chunk)
            if written > MAX_RECORDING_BYTES:
                break  # stop early rather than filling the disk
    return written


def _free_path(directory: Path, name: str) -> Path:
    """A path in `directory` that no existing recording occupies."""
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / name
    stem, suffix = Path(name).stem, Path(name).suffix
    version = 1
    while candidate.exists():
        candidate = directory / f"{stem}({version}){suffix}"
        version += 1
    return candidate
