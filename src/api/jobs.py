"""Background jobs: one recording in, one finished report out.

Transcription takes minutes, so uploads cannot be processed inside the request.
Each upload becomes a job that runs on Starlette's worker threadpool while the
browser polls for its status.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import pipeline
from services.config import Settings
from services.measurements import format_measurement

log = logging.getLogger(__name__)

QUEUED, RUNNING, DONE, FAILED = "queued", "running", "done", "failed"

# How many flagged rows the status endpoint carries. Enough to review on screen
# without turning a poll into a full report download.
MAX_FLAGGED_DETAIL = 25

# Which downloads a finished job offers, and the PipelineResult attribute each
# one comes from.
DOWNLOADS = {
    "report": ("pdf_path", "application/pdf"),
    "graded": ("graded_pdf_path", "application/pdf"),
    "form": ("form_csv_path", "text/csv"),
    "measurements": ("measurements_csv_path", "text/csv"),
    "graded_data": ("graded_csv_path", "text/csv"),
    "data": ("json_path", "application/json"),
}

# How many open questions the status endpoint carries. The count is always
# exact; this only caps the detail rendered on screen.
MAX_UNCONFIRMED_DETAIL = 25


@dataclass
class Job:
    """One upload, from arrival to finished report."""

    id: str
    filename: str
    style_no: str = ""  # chosen at upload; "" means use whatever the recording announces
    status: str = QUEUED
    message: str = "waiting to start"
    name: str = ""
    rows: int = 0
    flagged: int = 0
    sizes: list[str] = field(default_factory=list)
    error: str = ""
    files: dict[str, Path] = field(default_factory=dict)
    form: dict[str, str] = field(default_factory=dict)
    accessories: int = 0
    comments: int = 0
    flagged_rows: list[dict[str, object]] = field(default_factory=list)
    # The check against the graded spec sheet. `graded` is False when no style
    # set could be matched, in which case nothing was verified against spec and
    # the operator has to pick the style by hand.
    graded: bool = False
    graded_style_no: str = ""
    announced_style_no: str = ""
    measurement_result: str = ""
    judged: int = 0
    out_of_tolerance: int = 0
    unconfirmed: int = 0
    unconfirmed_rows: list[dict[str, object]] = field(default_factory=list)
    failed_rows: list[dict[str, object]] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    finished_at: float = 0.0

    @property
    def elapsed(self) -> float:
        """Seconds spent so far, or the total once finished."""
        return (self.finished_at or time.time()) - self.started_at

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "filename": self.filename,
            "style_no": self.style_no,
            "status": self.status,
            "message": self.message,
            "name": self.name,
            "rows": self.rows,
            "flagged": self.flagged,
            "sizes": self.sizes,
            "error": self.error,
            "downloads": sorted(self.files),
            "form": self.form,
            "accessories": self.accessories,
            "comments": self.comments,
            "flagged_rows": self.flagged_rows,
            "graded": self.graded,
            "graded_style_no": self.graded_style_no,
            "announced_style_no": self.announced_style_no,
            "measurement_result": self.measurement_result,
            "judged": self.judged,
            "out_of_tolerance": self.out_of_tolerance,
            "unconfirmed": self.unconfirmed,
            "unconfirmed_rows": self.unconfirmed_rows,
            "failed_rows": self.failed_rows,
            "elapsed": round(self.elapsed, 1),
        }


class JobStore:
    """In-memory job registry.

    ponytail: jobs are lost on restart. That is fine for a single operator
    watching one upload at a time; move to SQLite if history has to survive.
    """

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, filename: str, style_no: str = "") -> Job:
        job = Job(id=uuid.uuid4().hex[:12], filename=filename, style_no=style_no)
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def all(self) -> list[Job]:
        """Newest first."""
        with self._lock:
            return list(reversed(self._jobs.values()))


def process(job: Job, recording: Path, settings: Settings, store: JobStore) -> None:
    """Run the whole pipeline for one upload, recording progress on the job."""
    del store  # the job object is shared; the store is only needed to look it up
    _run_and_record(
        job,
        lambda announce: pipeline.run(
            recording, settings, announce=announce, style_no=job.style_no
        ),
    )


def process_transcript(
    job: Job, transcript_text: str, name: str, settings: Settings, store: JobStore
) -> None:
    """Same, for an inspection that was transcribed elsewhere.

    The text arrives from a live meeting transcript, so stage 1 is skipped.
    Everything after it — extraction, grading against the style set, and all
    four outputs — is identical, which is the point: one report format, however
    the audio reached us.
    """
    del store
    _run_and_record(
        job,
        lambda announce: pipeline.run_from_transcript(
            transcript_text, name, settings, style_no=job.style_no, announce=announce
        ),
    )


def _run_and_record(job: Job, invoke) -> None:
    """Run one pipeline call and copy its result onto the job.

    Shared by both entry points so the status payload the browser polls cannot
    drift between them — a field populated for uploads but not for meetings
    would show up as a silently empty column in the UI.
    """
    job.status = RUNNING
    try:
        result = invoke(lambda message: setattr(job, "message", message))
    except Exception as exc:  # noqa: BLE001 - a background task must not die silently
        log.exception("job %s failed", job.id)
        job.status, job.error = FAILED, str(exc)
        job.message = "failed"
        job.finished_at = time.time()
        return

    apply_result(job, result)


def apply_result(job: Job, result) -> None:
    """Copy a finished pipeline result onto the job.

    Split out of `_run_and_record` because settling a cell in the audit view
    rebuilds the very same result from the edited extraction, and the status
    payload the browser polls has to move with it - counts, verdict, downloads
    and all - or the report on screen disagrees with the files behind it.
    """
    sheet = result.sheet
    job.name = result.name
    job.rows = len(sheet.rows)
    job.flagged = result.flagged_count
    job.sizes = sheet.sizes()
    job.files = {
        kind: path
        for kind, (attribute, _) in DOWNLOADS.items()
        if (path := getattr(result, attribute)) is not None
    }
    job.form = dict(sheet.form)
    job.accessories = len(sheet.accessories)
    job.comments = len(sheet.comments)
    job.flagged_rows = [
        {
            "no": number,
            "size": row.size,
            "field": row.field,
            "value": row.value,
            "deviation": row.deviation,
            "confidence": round(row.confidence, 2),
            "note": row.note,
        }
        for number, row in sheet.flagged()[:MAX_FLAGGED_DETAIL]
    ]
    _record_grading(job, result)
    job.message = f"{job.rows} rows, {job.flagged} need review"
    if job.unconfirmed:
        job.message += f", {job.unconfirmed} verdict(s) not captured"
    job.finished_at = time.time()
    job.status = DONE


def _record_grading(job: Job, result) -> None:
    """Copy the check against the spec sheet onto the job.

    The unconfirmed points of measure matter most: those are the ones the
    recording never ruled on, and the browser has to show them or an operator
    downloads a report believing the blanks were passes.
    """
    job.announced_style_no = result.sheet.field("style_no")
    alignment = result.alignment
    if alignment is None:
        job.graded = False
        return

    job.graded = True
    job.graded_style_no = alignment.style_no
    job.measurement_result = alignment.verdict
    job.judged = len(alignment.judged)
    job.out_of_tolerance = len(alignment.failures)
    job.unconfirmed = len(alignment.unconfirmed)
    job.unconfirmed_rows = [
        {
            "no": row.number,
            "size": row.size,
            "pom": row.pom,
            "description": row.description,
            "spec": _measure(row.spec),
            "spoken": row.spoken,
        }
        for row in alignment.unconfirmed[:MAX_UNCONFIRMED_DETAIL]
    ]
    job.failed_rows = [
        {
            "no": row.number,
            "size": row.size,
            "pom": row.pom,
            "description": row.description,
            "spec": _measure(row.spec),
            "measured": _measure(row.measured),
            "deviation": _measure(row.deviation, signed=True),
        }
        for row in alignment.failures[:MAX_UNCONFIRMED_DETAIL]
    ]


def _measure(value, signed: bool = False) -> str:
    return "" if value is None else format_measurement(value, signed=signed)
