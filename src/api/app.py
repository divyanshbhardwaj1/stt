"""FastAPI app: upload a recording, watch it process, download the report."""

from __future__ import annotations

import logging
import re
import shutil
import tempfile
import uuid
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select

from pipeline import resize_inspection, settle_inspection
from services import auth, storage, trail
from services.audit import SettleError, audit_grid
from services.config import ConfigError, Settings, load_env_file
from services.csv_filler import load_json
from services.db import session
from services.db.models import Event, Stage, User, UserState
from services.measurements import format_measurement
from services.playback import cues, playable_copy, playable_path_for
from services.style_set import (
    SpecSheetError,
    StyleSetNotFound,
    align,
    find_style_set,
    list_style_numbers,
    read_library,
    read_style_set,
    style_set_files,
)
from services.timing import TimingError, word_index
from services.transcript import (
    AUDIO_SUFFIXES,
    DOMAIN_PROMPT,
    LANGUAGES,
    live_transcript_path_for,
)
from services.transcript.transcription_service import MAX_UPLOAD_BYTES

from .jobs import (
    DONE,
    DOWNLOADS,
    JobStore,
    apply_result,
    detail_rows,
    process,
    process_transcript,
)
from .security import (
    SESSION_COOKIE,
    DownloadsWorking,
    EditsAudit,
    ManagesPeople,
    ManagesStyles,
    Records,
    SignedIn,
    ViewsAudit,
    clear_cookie,
    set_cookie,
)

log = logging.getLogger(__name__)

# Read `.env` here rather than relying on whoever started the process having
# done it. `python src/main.py serve` happened to work only because
# `Settings.load()` loads the file and uvicorn inherits the environment; a
# plain `uvicorn api.app:app` did not, and failed at startup with no database.
# The same reasoning as `migrations/env.py`: a module that needs configuration
# should fetch it, not hope.
#
# Safe in every environment. `load_env_file` uses setdefault, so a real
# environment variable always wins and a deployment with no .env is unaffected
# — which is also why the test suite can blank DATABASE_URL and have it stay
# blank (tests/conftest.py, and the test that proves it).
load_env_file()

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

# The checks that can actually be recorded into.
#
# One, today. The pipeline is size-set-specific all the way down — the
# extraction prompt, the spec-sheet alignment and the 26 fields of the client's
# workbook — and a Final inspection is a sampling plan against an accept
# number, which none of that computes. The other three stages exist on screen,
# in the roster and on this column, and they are filled with demo data so the
# shape of the product is visible; what they do not have is somewhere for a
# real recording to go. Queuing one anyway would run the size-set pipeline over
# it and file the result under Final, which is a fabricated document in the one
# place this product exists to keep honest.
#
# Adding a stage here is the last line of building it, not the first.
RECORDABLE_STAGES = frozenset({Stage.sizeset.value})


def _stage_for(stage: str, user: User) -> str:
    """The stage an upload is filed under, or a refusal saying why not.

    Two separate questions, and they get different answers. Whether the stage
    can be recorded into at all is about this deployment; whether *you* may
    record into it is about your roster row on that stage — and asking the
    second against `DEFAULT_STAGE`, as every other check here still does,
    would let somebody who holds `record` on size set alone record into Final
    the day Final starts working.
    """
    filed = (stage or Stage.sizeset.value).strip()
    if filed not in {member.value for member in Stage}:
        raise HTTPException(status_code=422, detail=f"there is no {filed!r} stage")
    if filed not in RECORDABLE_STAGES:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{filed} has no pipeline yet, so a recording filed under it could not "
                "be graded — only transcribed and left looking like a report. Record it "
                "under size set, which is the check this product performs today."
            ),
        )
    if not auth.can(user, "record", filed):
        raise HTTPException(status_code=403, detail=auth.REASONS["record"])
    return filed


# The one roster rule that is not about permissions.
LAST_ADMIN = (
    "This is the last administrator. Promote somebody else first, or nobody can "
    "manage the roster."
)

# Replaced at startup, once the database is known to be there. Module level
# only so that importing this module never opens a connection — which is what
# let the test suite reach a real database in §31.4.
store: JobStore = JobStore()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Open the job registry, and refuse to serve without a database.

    This is the hard failure `services/db/session.py` said would eventually be
    right. Users, sessions and permissions live in the database now, so a
    web app without one cannot authenticate anybody — and an app that cannot
    authenticate anybody must not fall back to serving everybody.

    The CLI pipeline is untouched: `python src/main.py run` needs no database
    and never did.
    """
    global store
    from services.db import DatabaseJobStore, enabled

    if not enabled():
        raise RuntimeError(
            "DATABASE_URL is not set, and the web app needs one: users, sessions "
            "and permissions live in the database. Set it in .env and run "
            "`alembic upgrade head`. The CLI (`python src/main.py run`) still works "
            "without a database."
        )
    store = DatabaseJobStore()
    log.info("jobs are persisted; %d recovered", len(store.all()))
    # The library before the first request. A container with an empty disk
    # cannot grade anything, and the bucket is where an uploaded sheet lives.
    # Guarded on the bucket first so that an app without one - every test run,
    # and any local checkout - never pays for a Settings.load() it cannot use.
    if storage.enabled():
        try:
            pulled = storage.pull_all(storage.STYLE_SETS, Settings.load().style_sets_dir)
        except ConfigError as exc:
            log.warning("could not restore the style set library: %s", exc)
        else:
            log.info("pulled %d style sets from the bucket", pulled)
    yield


app = FastAPI(
    title="Size Set Inspection Reports", docs_url="/api/docs", lifespan=lifespan
)


@app.middleware("http")
async def never_cache_the_api(request: Request, call_next):
    """No browser cache on anything under /api.

    Every answer here is about state that changes: a job's progress, a graded
    sheet, who is signed in. None of it is worth caching and some of it is
    actively harmful to cache — 404 and **410 are cacheable by default**, so a
    sheet that was briefly missing stayed missing in the browser long after the
    server could serve it again, with no way for the operator to tell that the
    fault was already fixed.

    The HTML shell already sets this for itself (see `index`); this covers the
    data behind it.
    """
    response = await call_next(request)
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store, must-revalidate"
    return response

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


# The trail as the screen reads it. Not everything ever written: a log that
# tries to render six months in one request is a log nobody opens twice.
ACTIVITY_LIMIT = 500


@app.get("/api/activity")
def activity(user: SignedIn, limit: int = ACTIVITY_LIMIT) -> list[dict[str, object]]:
    """The audit trail, newest first."""
    with session() as db:
        rows = db.scalars(
            select(Event).order_by(Event.at.desc()).limit(min(max(limit, 1), ACTIVITY_LIMIT))
        ).all()
        return [
            {
                "id": str(row.id),
                "at": row.at.isoformat(),
                "user_id": str(row.user_id) if row.user_id else None,
                "actor": row.actor,
                "kind": row.kind,
                "stage": row.stage,
                "what": row.what,
                "subject": row.subject,
            }
            for row in rows
        ]


@app.get("/api/style-sets")
def list_style_sets(settings: SettingsDep, user: SignedIn) -> list[str]:
    """Style numbers with a spec sheet on disk, for the upload dropdown."""
    return list_style_numbers(settings.style_sets_dir)


def _last_graded() -> dict[str, float]:
    """The most recent inspection to be checked against each style.

    Read off the job registry rather than counted in a column: every finished
    job already records the style it graded against, and a second place to
    write that down is a second place for it to be wrong.
    """
    latest: dict[str, float] = {}
    for job in store.all():
        style = job.graded_style_no
        if style:
            latest[style] = max(latest.get(style, 0.0), job.started_at)
    return latest


def _sheet_row(path: Path, style, used: float) -> dict[str, object]:
    """One line of the library table."""
    if style is None:
        # Kept in the list. A sheet that cannot be read is exactly the sheet
        # somebody needs to be told about, and dropping it silently means the
        # first anybody hears of it is a recording that will not grade.
        return {
            "style_no": "",
            "document": path.name,
            "readable": False,
            "description": "This sheet could not be read",
            "company": "",
            "season": "",
            "division": "",
            "status": "",
            "base_size": "",
            "sizes": [],
            "poms": 0,
            "tolerance_model": "",
            "from_scan": False,
            "last_used": None,
        }
    return {
        "style_no": style.style_no,
        "document": path.name,
        "readable": True,
        "description": style.description,
        "company": style.company,
        "season": style.season,
        "division": style.division,
        "status": style.status,
        "base_size": style.base_size,
        "sizes": list(style.sizes),
        "poms": len(style.measured_rows()),
        "tolerance_model": style.tolerance_model,
        "from_scan": style.from_scan,
        "last_used": used or None,
    }


@app.get("/api/style-sets/sheets")
def library(settings: SettingsDep, user: SignedIn) -> list[dict[str, object]]:
    """The library, one entry per sheet, with what is inside each one.

    Separate from `GET /api/style-sets` on purpose. That one is on the path to
    recording - it fills the style picker before an inspection starts - and
    must never wait on a PDF parser. This one is the library screen, where
    reading the sheets is the job.
    """
    used = _last_graded()
    return [
        _sheet_row(path, style, used.get(style.style_no if style else "", 0.0))
        for path, style in read_library(settings.style_sets_dir)
    ]


def _found(style_no: str, settings: Settings):
    """The sheet filed under `style_no`, or a 404."""
    for path, style in read_library(settings.style_sets_dir):
        if style is not None and style.style_no == style_no:
            return path, style
    raise HTTPException(status_code=404, detail=f"no sheet for style {style_no} in the library")


@app.get("/api/style-sets/sheets/{style_no}")
def sheet_detail(style_no: str, settings: SettingsDep, user: SignedIn) -> dict[str, object]:
    """One sheet with its whole graded specification, as the dialog shows it."""
    path, style = _found(style_no, settings)
    row = _sheet_row(path, style, _last_graded().get(style_no, 0.0))
    row["rows"] = [
        {
            "pom": pom.pom,
            "description": pom.description,
            "minus": format_measurement(pom.tolerance_minus, signed=True)
            if pom.tolerance_minus is not None
            else "",
            "plus": format_measurement(pom.tolerance_plus, signed=True)
            if pom.tolerance_plus is not None
            else "",
            "specs": {
                size: format_measurement(value) if value is not None else ""
                for size, value in pom.specs.items()
            },
        }
        for pom in style.rows
    ]
    return row


@app.get("/api/style-sets/sheets/{style_no}/pdf")
def sheet_pdf(style_no: str, settings: SettingsDep, user: DownloadsWorking) -> Response:
    """The buyer's own document, as issued."""
    path, _ = _found(style_no, settings)
    return FileResponse(path, media_type="application/pdf", filename=path.name)


@app.delete("/api/style-sets/sheets/{style_no}")
def remove_style_set(style_no: str, settings: SettingsDep, user: ManagesStyles) -> dict[str, str]:
    """Take a sheet out of the library.

    Reports graded against it keep everything they need: the extraction holds
    the spec that was used, so an old report is unaffected. What stops is new
    inspections being checkable against this style.
    """
    path, _ = _found(style_no, settings)
    path.unlink(missing_ok=True)
    storage.forget(storage.style_set_key(path.name))
    log.info("style set %s removed by %s", style_no, user.email)
    trail.record(
        user, trail.ACCESS, f"Removed {path.name} from the library", subject=style_no
    )
    return {"removed": style_no}


# A graded sheet is a few hundred kilobytes of vector PDF. Anything at this
# size is a scan of a scan, which is rejected below anyway for having no text.
MAX_STYLE_SET_BYTES = 25 * 1024 * 1024

# The style number becomes a filename, and it is read out of a document the
# server did not write. Digits, letters and a dash - nothing that can climb out
# of the directory or collide with the `.part` files `storage.fetch` leaves.
SAFE_STYLE_NO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")


def _style_summary(style, path: Path) -> dict[str, object]:
    """What the library screen shows back after a sheet is accepted."""
    return {
        "style_no": style.style_no,
        "description": style.description,
        "season": style.season,
        "sizes": list(style.sizes),
        "poms": len(style.measured_rows()),
        "document": path.name,
    }


@app.post("/api/style-sets", status_code=201)
async def add_style_set(
    sheet: UploadFile,
    settings: SettingsDep,
    user: ManagesStyles,
    replace: Annotated[bool, Form()] = False,
) -> dict[str, object]:
    """Add a buyer's graded spec sheet to the library.

    The sheet is parsed before it is filed, and the style number comes out of
    the document rather than off the filename or a form field. Every
    measurement on every report is rebuilt as a spec from one of these plus the
    deviation the inspector called, so a sheet that cannot be read, or that is
    not the style it claims, is worse than no sheet at all - it grades silently
    and wrongly.

    Scans are refused. `find_style_set` will read one when it is all there is,
    at the cost of a model and a warning on every report it touches; an upload
    is the one moment somebody can be told to export the PDF properly instead.
    """
    name = Path(sheet.filename or "").name
    if Path(name).suffix.lower() != ".pdf":
        raise HTTPException(
            status_code=415,
            detail="Style sets are PDFs. Export the graded sheet from the buyer's "
            "system - a photo, a screenshot or a spreadsheet cannot be graded against.",
        )

    # Parsed in a scratch directory, because `find_style_set` globs the library
    # for *.pdf: a sheet dropped there to be validated is a sheet a pipeline
    # running in the background can pick up half-written.
    with tempfile.TemporaryDirectory() as scratch:
        staged = Path(scratch) / "upload.pdf"
        written = await _save(sheet, staged)
        if written > MAX_STYLE_SET_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"{name} is {written / 1e6:.0f} MB, over the "
                f"{MAX_STYLE_SET_BYTES / 1e6:.0f} MB limit for a spec sheet.",
            )
        try:
            # No `settings`: that is the switch that lets a sheet be read off an
            # image, and an upload is refused rather than read that way.
            style = read_style_set(staged, None)
        except SpecSheetError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"{name} could not be read as a graded sheet: {exc}",
            ) from exc

        if not SAFE_STYLE_NO.match(style.style_no or ""):
            raise HTTPException(
                status_code=422,
                detail=f"{name} does not carry a usable style number"
                + (f" (it reads {style.style_no!r})" if style.style_no else ""),
            )
        if not style.measured_rows():
            raise HTTPException(
                status_code=422,
                detail=f"{name} has no points of measure, so nothing could be checked "
                "against it.",
            )

        # Any existing sheet whose name carries this number, not just the one
        # this upload would write: `find_style_set` matches on the digits in the
        # filename, so `style_9662_clean.pdf` already answers for 9662.
        clashes = [
            path
            for path in style_set_files(settings.style_sets_dir)
            if style.style_no in set(re.findall(r"\d+", path.stem))
        ]
        if clashes and not replace:
            raise HTTPException(
                status_code=409,
                detail=f"style {style.style_no} is already in the library as "
                f"{', '.join(path.name for path in clashes)}. Upload again with "
                "replace to overwrite it.",
            )

        target = settings.style_sets_dir / f"style_{style.style_no}.pdf"
        target.parent.mkdir(parents=True, exist_ok=True)
        for path in clashes:
            if path != target:
                path.unlink(missing_ok=True)
        shutil.move(str(staged), target)

    storage.mirror(storage.style_set_key(target.name), target)
    log.info("style set %s added by %s", style.style_no, user.email)
    trail.record(
        user,
        trail.ACCESS,
        f"Added {target.name} to the library - {len(style.measured_rows())} points of measure",
        subject=style.style_no,
    )
    return _style_summary(style, target)


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
def realtime_token(settings: SettingsDep, user: Records) -> dict[str, object]:
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
def list_jobs(user: ViewsAudit, stage: str = "") -> list[dict[str, object]]:
    """Every inspection, newest first, optionally narrowed to one stage.

    Unfiltered by default. The register is read stage by stage on screen, but
    the dashboard counts across the floor and a client that has to ask four
    times to do that is four round trips for one question.
    """
    jobs = store.all()
    if stage:
        jobs = [job for job in jobs if job.stage == stage]
    return [job.as_dict() for job in jobs]


@app.get("/api/jobs/{job_id}")
def read_job(job_id: str, settings: SettingsDep, user: ViewsAudit) -> dict[str, object]:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    _rehydrate(job, settings)
    payload = job.as_dict()
    payload["transcript"] = bool(_transcript_path(job, settings))
    # The client's own wording for each header field, straight off their
    # workbook — the same labels `pdf_writer` prints. Sent with the job rather
    # than guessed at in the browser, so the screen and the paper cannot
    # disagree about what a field is called.
    payload["form_labels"] = _form_labels(settings)
    return payload


@lru_cache(maxsize=4)
def _labels_from(template_path: Path) -> dict[str, str]:
    from services.csv_filler.report_template import ALL_FIELD_LABELS, load_template

    template = load_template(template_path)
    return {field: template.display_label(field) for field in ALL_FIELD_LABELS}


def _form_labels(settings: Settings) -> dict[str, str]:
    """Field name to printed label, or {} when the template is not readable.

    Cached on the path: it is the client's blank workbook and does not change
    between requests, and reading an .xls per poll would be absurd.
    """
    try:
        return _labels_from(settings.form_template_path)
    except Exception:  # noqa: BLE001 - a missing label is cosmetic
        log.warning("could not read the form template for its labels")
        return {}


def _rehydrate(job, settings: Settings) -> None:
    """Rebuild the report's detail tables if a restart dropped them.

    The counts are columns and survive; the rows behind them are derived from
    the saved extraction and are not stored (see `detail_rows`). Without this
    a revived job says "2 measurements out of tolerance" above an empty table,
    which reads as a bug in the grading rather than in the bookkeeping.

    Done here rather than on the job list: it reads the extraction and the
    style set off disk, which is far too much for an endpoint the browser
    polls every two seconds. Once per job, then the lists are on the object.
    """
    if job.status != DONE or not job.graded:
        return
    if job.unconfirmed_rows or job.failed_rows or job.flagged_rows:
        return
    if not (job.unconfirmed or job.out_of_tolerance or job.flagged):
        return
    try:
        sheet, style = _graded_sheet(job, settings)
        detail_rows(job, sheet, align(sheet, style))
    except (HTTPException, StyleSetNotFound, OSError, ValueError):
        # The report still renders with its counts and its verdict. A missing
        # extraction is already reported by the audit view, which is the screen
        # that cannot do without it.
        log.warning("could not rebuild the detail rows for job %s", job.id)


@app.post("/api/jobs", status_code=202)
async def create_job(
    background: BackgroundTasks,
    recording: UploadFile,
    settings: SettingsDep,
    user: Records,
    style_no: Annotated[str, Form()] = "",
    live_transcript: Annotated[str, Form()] = "",
    location: Annotated[str, Form()] = "",
    stage: Annotated[str, Form()] = "",
) -> dict[str, object]:
    """Accept a recording and queue it. Returns immediately with a job to poll.

    `style_no` is the style set to check against. Leave it empty to fall back to
    the style number announced at the start of the recording.

    `stage` is which of the four checks this is. Only size set has a pipeline
    behind it, so it is the only one accepted here — see `_stage_for`.

    `live_transcript` is what the browser's monitor heard while recording. It is
    saved beside the batch transcripts for audit and never read by the pipeline.
    """
    filed = _stage_for(stage, user)
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

    job = store.create(destination.name, style_no=chosen, stage=filed)
    # Provenance, captured at the only moment anything knows it: the signed-in
    # account that sent the file, and whichever bench the operator typed.
    job.recorded_by_id = user.id
    job.recorded_by = user.name
    job.location = location.strip()[:128]
    trail.record(
        user,
        trail.RECORD,
        f"Recorded an inspection - {name}"
        + (f", checked against style {chosen}" if chosen else ""),
        subject=job.name or chosen,
    )
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
    user: Records,
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


def _local_recording(job, settings: Settings) -> Path:
    """The inspection audio, on this machine.

    Pulled from the bucket when this machine has never seen it, which is the
    normal case for any server that did not run the pipeline — a replaced
    container, a second instance, or a worker split off from the web process.
    """
    path = settings.recordings_dir / job.filename
    if not storage.ensure_local(storage.recording_key(job.filename), path):
        raise HTTPException(
            status_code=410, detail=f"{job.filename} is no longer in the recordings folder"
        )
    return path


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
    # The extraction is what every output is rebuilt from, so this is the one
    # file the audit view cannot do without. Worth a round trip to the bucket.
    if not storage.ensure_local(storage.output_key(job.name, saved.name), saved):
        raise HTTPException(status_code=410, detail=f"{saved.name} is no longer on disk")
    sheet = load_json(saved)
    try:
        style = find_style_set(job.graded_style_no, settings.style_sets_dir, settings)
    except StyleSetNotFound as exc:
        raise HTTPException(status_code=410, detail=str(exc)) from exc
    return sheet, style


@app.get("/api/jobs/{job_id}/sheet")
def graded_sheet(job_id: str, settings: SettingsDep, user: ViewsAudit) -> dict[str, object]:
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
def settle_sheet(
    job_id: str, body: dict, settings: SettingsDep, user: EditsAudit
) -> dict[str, object]:
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
    trail.record(
        user,
        trail.CORRECTION,
        f"Settled {len(edits)} reading{'' if len(edits) == 1 else 's'} by hand"
        + (f" - {len(misplaced)} did not align back" if misplaced else ""),
        subject=job.name or job.graded_style_no,
    )
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
def regrade(
    job_id: str, body: dict, settings: SettingsDep, user: EditsAudit
) -> dict[str, object]:
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
    trail.record(
        user,
        trail.CORRECTION,
        f"Regraded the sheet from {from_size} to {to_size} - every row rebuilt",
        subject=job.name or job.graded_style_no,
    )
    sheet, style = _graded_sheet(job, settings)
    return {"job": job.as_dict(), "sheet": audit_grid(align(sheet, style), style, sheet)}


@app.get("/api/jobs/{job_id}/audio")
def recording_audio(job_id: str, settings: SettingsDep, user: ViewsAudit) -> Response:
    """The inspection recording itself, so a reading can be listened back to.

    Served whole rather than sliced: both Starlette and S3 answer Range
    requests, so the browser fetches only the seconds it plays. Cutting clips
    server-side would mean writing and cleaning up a file per cell for no gain.

    With a bucket configured this redirects to a signed URL instead of piping
    the bytes. A half-hour recording is tens of megabytes and an operator
    working through a sheet seeks it dozens of times; there is no reason for an
    app worker to sit in the middle of that.
    """
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    path = _local_recording(job, settings)
    served = _seekable(job, path, settings)
    if storage.enabled():
        key = storage.playback_key(job.filename)
        if storage.mirror_once(key, served):
            return RedirectResponse(storage.presign(key, filename=path.name), status_code=307)
    return FileResponse(
        served,
        media_type="audio/mpeg" if served.suffix == ".mp3" else None,
        filename=path.name,
        # inline, or the browser treats a media subresource as a download.
        content_disposition_type="inline",
    )


def _seekable(job, recording: Path, settings: Settings) -> Path:
    """A copy of the recording the browser can seek accurately.

    A seekable re-encode, not the upload itself. Phone MP3s are variable
    bitrate with no seek header and browser WebM carries no duration, and in
    both cases the browser maps a cue's second onto the wrong byte - which
    lands every reading in the same stretch of audio. See playable_copy.

    Built on first ask, here or on whichever machine was asked first: most
    inspections are never listened back to, and re-encoding every one of them
    up front would be paying ffmpeg for a feature nobody used.
    """
    cached = playable_path_for(recording, settings)
    if not cached.is_file():
        storage.fetch(storage.playback_key(job.filename), cached)
    return playable_copy(recording, settings)


@app.get("/api/jobs/{job_id}/cues")
def playback_cues(job_id: str, settings: SettingsDep, user: ViewsAudit) -> dict[str, object]:
    """Where each reading sits in the recording.

    Built on first ask and cached beside the transcripts, because most
    inspections are never listened back to and indexing every one of them would
    be paying for a feature nobody used.
    """
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    sheet, style = _graded_sheet(job, settings)
    recording = _local_recording(job, settings)
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
            str(number): {
                "start": round(cue.start, 2),
                "end": round(cue.end, 2),
                "exact": cue.exact,
            }
            for number, cue in found.items()
        },
    }


# Which capability each download needs. The PDFs are the vendor-facing
# documents — the ones stamped "Subject to Legal Action if Disclosed Without
# Authorization from AEO" — and releasing one is an approver's act. The CSVs
# and the JSON are working files the QA team reads while settling a sheet.
VENDOR_DOWNLOADS = {"report", "graded"}


def _transcript_path(job, settings: Settings) -> Path | None:
    """The saved transcript for this inspection, if one was written.

    The batch transcript, not the live monitor's: this is the text the report
    was actually extracted from, which is what somebody checks a disputed
    measurement against.
    """
    for candidate in (
        settings.transcripts_dir / f"{job.name}.txt",
        settings.transcripts_dir / f"{Path(job.filename).stem}.txt",
    ):
        if job.name and candidate.is_file():
            return candidate
    return None


@app.get("/api/jobs/{job_id}/transcript")
def transcript(job_id: str, settings: SettingsDep, user: ViewsAudit) -> Response:
    """The transcript the report was built from, as plain text."""
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    found = _transcript_path(job, settings)
    if found is None:
        raise HTTPException(
            status_code=404,
            detail="no transcript was saved for this inspection",
        )
    return FileResponse(found, media_type="text/plain; charset=utf-8", filename=found.name)


@app.get("/api/jobs/{job_id}/download/{kind}")
def download(job_id: str, kind: str, user: SignedIn) -> Response:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    if job.status != DONE:
        raise HTTPException(status_code=409, detail=f"job is {job.status}, not ready")
    if kind not in DOWNLOADS or kind not in job.files:
        raise HTTPException(status_code=404, detail=f"no {kind!r} output for this job")

    needed = "download.vendor" if kind in VENDOR_DOWNLOADS else "download.working"
    if not auth.can(user, needed):
        raise HTTPException(status_code=403, detail=auth.REASONS[needed])

    path = job.files[kind]
    key = storage.output_key(job.name, path.name)
    # The bucket first when there is one, because it is the copy that is
    # current on every machine. Signed rather than proxied, and marked as an
    # attachment so the filename survives the redirect.
    if storage.mirror_once(key, path) or storage.exists(key):
        return RedirectResponse(
            storage.presign(key, filename=path.name, download=True), status_code=307
        )
    if not path.is_file():
        raise HTTPException(status_code=410, detail=f"{path.name} is no longer on disk")
    if kind in VENDOR_DOWNLOADS:
        # Only the vendor documents. Every working file is downloaded a dozen
        # times while a sheet is being settled, and a trail that records all of
        # them buries the one line that matters - the copy that left the building.
        trail.record(
            user,
            trail.ACCESS,
            f"Downloaded the {kind} for a vendor",
            subject=job.name or job.graded_style_no,
        )
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


# ---------------------------------------------------------------- sessions
class Credentials(BaseModel):
    email: str
    password: str


class PasswordChange(BaseModel):
    current: str = ""
    password: str


@app.post("/api/session")
def open_session(
    credentials: Credentials, request: Request, response: Response
) -> dict[str, object]:
    """Sign in. Sets an httpOnly cookie and describes who you are.

    Every failure is the same 401 with the same wording — see `auth.sign_in`
    for why: a message that distinguishes "no such address" from "wrong
    password" tells an anonymous caller which of your colleagues have accounts.
    """
    with session() as db:
        try:
            user, token = auth.sign_in(
                db,
                credentials.email,
                credentials.password,
                user_agent=request.headers.get("user-agent", ""),
            )
        except auth.AuthError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        described = auth.describe(user)
    set_cookie(response, request, token)
    return described


@app.delete("/api/session")
def close_session(request: Request, response: Response) -> dict[str, str]:
    """Sign out. Ends this session only, not the others on other devices."""
    with session() as db:
        auth.sign_out(db, request.cookies.get(SESSION_COOKIE, ""))
    clear_cookie(response)
    return {"detail": "signed out"}


@app.get("/api/me")
def whoami(user: SignedIn) -> dict[str, object]:
    """Who is signed in and what they may do.

    The browser uses this to decide what to draw. It is a description of the
    rules, not the rules themselves — every one of them is enforced again on
    the way into each endpoint, because anything sent to a browser is a
    suggestion.
    """
    return auth.describe(user)


@app.post("/api/me/password")
def change_password(
    body: PasswordChange, user: SignedIn, response: Response
) -> dict[str, object]:
    """Change your own password, and sign every session out.

    Including this one. A password change usually means somebody may have the
    old one, and leaving the existing sessions alive means the change has not
    actually locked anybody out.
    """
    with session() as db:
        me = db.get(User, user.id)
        if me is None:
            raise HTTPException(status_code=401, detail="Sign in to continue.")
        if not auth.verify_password(body.current, me.password_hash):
            raise HTTPException(status_code=403, detail="That is not your current password.")
        try:
            me.password_hash = auth.hash_password(body.password)
        except auth.AuthError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        ended = auth.sign_out_everywhere(db, me.id)
    clear_cookie(response)
    return {"detail": "password changed, sign in again", "sessions_ended": ended}


# ----------------------------------------------------------------- members
class NewUser(BaseModel):
    email: str
    name: str
    roles: dict[str, str] = {}
    # {stage: {capability: granted}} - only where this person differs from the
    # role. Validated in `auth.set_roles`, which is the one place that knows
    # what a capability is.
    permissions: dict[str, dict[str, bool]] = {}
    admin: bool = False
    password: str = ""


class UserPatch(BaseModel):
    email: str | None = None
    name: str | None = None
    roles: dict[str, str] | None = None
    permissions: dict[str, dict[str, bool]] | None = None
    admin: bool | None = None
    state: str | None = None
    password: str | None = None


def _user(person: User) -> dict[str, object]:
    return {
        # The id is a UUID and crosses JSON as a string; the email is the
        # credential and is what a person recognises on a roster.
        "id": str(person.id),
        "email": person.email,
        "name": person.name,
        "admin": person.is_admin,
        "state": person.state,
        "roles": {member.stage: member.role for member in person.memberships},
        # Only where they differ from the role. The screen draws the role's own
        # capabilities from the role table and applies these on top, so a role
        # whose definition changes still moves everybody left on the preset.
        "permissions": {
            member.stage: dict(member.overrides or {})
            for member in person.memberships
            if member.overrides
        },
        "can_by_stage": {
            stage: sorted(auth.capabilities(person, stage))
            for stage in auth.stages_of(person)
        },
        "stages": auth.stages_of(person),
        "created_at": person.created_at.isoformat() if person.created_at else None,
        "last_seen_at": person.last_seen_at.isoformat() if person.last_seen_at else None,
    }


def _roles_said(roles: dict) -> str:
    """"sizeset: inspector, final: approver" - the roster change, in words."""
    return ", ".join(f"{stage}: {role}" for stage, role in sorted(roles.items()))


@app.get("/api/users")
def list_users(user: ManagesPeople) -> dict[str, object]:
    """The roster, plus what the screen needs to render a role picker.

    The role table is sent rather than hardcoded in the browser so that adding
    a capability is a server change only — the prototype's copy of this list
    going stale is exactly the drift this replaces.
    """
    with session() as db:
        people = db.scalars(select(User).order_by(User.name)).all()
        return {
            "users": [_user(person) for person in people],
            "stages": [stage.value for stage in Stage],
            "roles": [
                {"id": role, "label": auth.ROLE_LABELS[role], "can": sorted(allowed)}
                for role, allowed in auth.ROLES.items()
            ],
            "capabilities": [
                {"id": name, "label": label} for name, label in auth.CAPABILITIES
            ],
        }


@app.post("/api/users", status_code=201)
def add_user(body: NewUser, user: ManagesPeople) -> dict[str, object]:
    with session() as db:
        try:
            created = auth.create_user(
                db,
                body.email,
                body.name,
                password=body.password,
                roles=body.roles,
                overrides=body.permissions,
                is_admin=body.admin,
            )
        except auth.AuthError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        db.flush()
        made = _user(created)
    trail.record(
        user,
        trail.ACCESS,
        f"Added {made['name']} to the roster"
        + (" as an administrator" if made["admin"] else "")
        + (f" - {_roles_said(made['roles'])}" if made["roles"] else ""),
        subject=made["email"],
    )
    return made


@app.patch("/api/users/{user_id}")
def update_user(user_id: str, body: UserPatch, user: ManagesPeople) -> dict[str, object]:
    """Rename, re-role, promote, disable or reset a password.

    The one rule here that is not about permissions: the last administrator
    cannot be demoted or disabled. That is how a floor locks itself out of its
    own roster with nobody left who can fix it.
    """
    with session() as db:
        person = _find(db, user_id)
        if person is None:
            raise HTTPException(status_code=404, detail="That user is not on the roster.")

        losing_admin = body.admin is False and person.is_admin
        being_disabled = (
            body.state == UserState.disabled.value
            and person.state != UserState.disabled.value
        )
        if (losing_admin or being_disabled) and auth.last_admin(db, person.id):
            raise HTTPException(status_code=409, detail=LAST_ADMIN)

        try:
            if body.email is not None:
                fresh = auth.check_email(body.email)
                if fresh != person.email and db.scalar(
                    select(User).where(User.email == fresh)
                ):
                    raise auth.AuthError(f"“{fresh}” already has an account.")
                person.email = fresh
            if body.name is not None:
                if not body.name.strip():
                    raise auth.AuthError("A user needs a name.")
                person.name = body.name.strip()
            if body.admin is not None:
                person.is_admin = body.admin
            if body.roles is not None or body.admin is not None:
                # An administrator holds every stage by the flag, so their
                # membership rows are cleared rather than kept in step.
                auth.set_roles(
                    db,
                    person,
                    {} if person.is_admin else (body.roles or {}),
                    {} if person.is_admin else (body.permissions or {}),
                )
            if not person.is_admin and not person.memberships:
                raise auth.AuthError(
                    "Give them a role on at least one stage, or make them an administrator."
                )
            if body.state is not None:
                if body.state not in {state.value for state in UserState}:
                    raise auth.AuthError(f"{body.state!r} is not an account state.")
                person.state = body.state
            if body.password:
                person.password_hash = auth.hash_password(body.password)
                person.state = UserState.active.value
        except auth.AuthError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        # Anything that narrows what somebody may do takes effect now, not
        # whenever the token they are holding happens to run out.
        narrowed = bool(
            body.password
            or losing_admin
            or body.roles is not None
            # Withholding a capability narrows as surely as removing a role,
            # and an administrator who only touches the permissions must not
            # leave the old answer live in a session somebody is holding.
            or body.permissions is not None
            or being_disabled
        )
        if narrowed:
            auth.sign_out_everywhere(db, person.id)
        db.flush()
        changed = _user(person)
    trail.record(
        user,
        trail.ACCESS,
        f"Changed {changed['name']}: {', '.join(sorted(body.model_dump(exclude_unset=True)))}",
        subject=changed["email"],
    )
    return changed


@app.delete("/api/users/{user_id}")
def remove_user(user_id: str, user: ManagesPeople) -> dict[str, str]:
    """Remove an account.

    Its sessions go with it, by the foreign key. An account that has already
    touched an inspection should be disabled instead, so the record keeps
    pointing at somebody. The audit trail survives either way: an event keeps
    a snapshot of the name as well as the pointer, so removing an account
    leaves the log readable rather than full of blanks.
    """
    if user_id == str(user.id):
        raise HTTPException(
            status_code=409, detail="You cannot remove the account you are signed in with."
        )
    with session() as db:
        person = _find(db, user_id)
        if person is None:
            raise HTTPException(status_code=404, detail="That user is not on the roster.")
        if auth.last_admin(db, person.id):
            raise HTTPException(status_code=409, detail=LAST_ADMIN)
        gone = person.email
        name = person.name
        db.delete(person)
    trail.record(user, trail.ACCESS, f"Removed {name} from the roster", subject=gone)
    return {"detail": f"{gone} removed"}


def _find(db, user_id: str) -> User | None:
    """One user by id. A malformed uuid is "not here", not a 500.

    The id reaches this from a URL, so it is whatever somebody typed.
    """
    try:
        return db.get(User, uuid.UUID(user_id))
    except (ValueError, AttributeError, TypeError):
        return None
