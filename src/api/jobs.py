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

log = logging.getLogger(__name__)

QUEUED, RUNNING, DONE, FAILED = "queued", "running", "done", "failed"

# How many flagged rows the status endpoint carries. Enough to review on screen
# without turning a poll into a full report download.
MAX_FLAGGED_DETAIL = 25

# Which downloads a finished job offers, and the PipelineResult attribute each
# one comes from.
DOWNLOADS = {
    "report": ("pdf_path", "application/pdf"),
    "form": ("form_csv_path", "text/csv"),
    "measurements": ("measurements_csv_path", "text/csv"),
    "data": ("json_path", "application/json"),
}


@dataclass
class Job:
    """One upload, from arrival to finished report."""

    id: str
    filename: str
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

    def create(self, filename: str) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], filename=filename)
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
    job.status = RUNNING
    try:
        result = pipeline.run(
            recording,
            settings,
            announce=lambda message: setattr(job, "message", message),
        )
    except Exception as exc:  # noqa: BLE001 - a background task must not die silently
        log.exception("job %s failed", job.id)
        job.status, job.error = FAILED, str(exc)
        job.message = "failed"
        job.finished_at = time.time()
        return

    sheet = result.sheet
    job.name = result.name
    job.rows = len(sheet.rows)
    job.flagged = result.flagged_count
    job.sizes = sheet.sizes()
    job.files = {kind: getattr(result, attribute) for kind, (attribute, _) in DOWNLOADS.items()}
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
    job.message = f"{job.rows} rows, {job.flagged} need review"
    job.finished_at = time.time()
    job.status = DONE
