"""FastAPI app: upload a recording, watch it process, download the report."""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import BackgroundTasks, Depends, FastAPI, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse

from services.config import ConfigError, Settings
from services.style_set import list_style_numbers
from services.transcript import AUDIO_SUFFIXES
from services.transcript.transcription_service import MAX_UPLOAD_BYTES

from .jobs import DONE, DOWNLOADS, JobStore, process

log = logging.getLogger(__name__)

PAGE = Path(__file__).parent / "index.html"
CHUNK = 1024 * 1024

# The transcription API caps a single upload at MAX_UPLOAD_BYTES, but the
# pipeline re-encodes anything larger to 16 kHz mono before sending it, so the
# browser must not refuse a recording the pipeline could handle. This ceiling
# exists only to stop a runaway upload filling the disk; a half-hour inspection
# lands well under it even at phone-default quality.
MAX_RECORDING_BYTES = 500 * 1024 * 1024

app = FastAPI(title="Size Set Inspection Reports", docs_url="/api/docs")
store = JobStore()


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
    """The upload page, read from disk each time and never cached.

    Without no-store the browser serves a stale page after an edit, which looks
    exactly like the change not working.
    """
    return HTMLResponse(
        PAGE.read_text(encoding="utf-8"),
        headers={"Cache-Control": "no-store, must-revalidate"},
    )


@app.get("/api/style-sets")
def list_style_sets(settings: SettingsDep) -> list[str]:
    """Style numbers with a spec sheet on disk, for the upload dropdown."""
    return list_style_numbers(settings.style_sets_dir)


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
) -> dict[str, object]:
    """Accept a recording and queue it. Returns immediately with a job to poll.

    `style_no` is the style set to check against. Leave it empty to fall back to
    the style number announced at the start of the recording.
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

    job = store.create(destination.name, style_no=chosen)
    background.add_task(process, job, destination, settings, store)
    log.info("queued job %s for %s (style %s)", job.id, destination.name, chosen or "as announced")
    return job.as_dict()


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
