"""Keeping a job in the database, and getting it back after a restart.

The in-memory `Job` stays exactly what it was: a mutable object the pipeline
writes progress onto while it runs. This module only decides when that object
is worth writing down — on creation, on each announced stage, and when it
finishes or fails. Persisting every attribute set would put a transaction
inside a loop for no gain; persisting only at the end would lose the eight
minutes of progress a restart interrupts, which is the whole point.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from fractions import Fraction
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from api.jobs import DONE, FAILED, Job, JobStore
from services.measurements import format_measurement, parse

from .models import Inspection, Reading, Stage
from .session import session

log = logging.getLogger(__name__)


# --------------------------------------------------------------- measurements
SIXTEENTHS = 16


def to_sixteenths(value: Fraction | None) -> int | None:
    """A measurement as a whole number of sixteenths, or None.

    Every value on these sheets is a binary fraction — halves down to
    sixteenths — so this is exact, and it is exact on the way back. It exists
    so the database can sort and aggregate measurements without a float ever
    being involved; the printed form is stored alongside it and is what a
    person reads.
    """
    if value is None:
        return None
    scaled = value * SIXTEENTHS
    if scaled.denominator != 1:
        # Finer than a sixteenth means the sheet is not what we think it is.
        # Round rather than refuse — losing the row would lose more — but say
        # so, because it is evidence about the source document.
        #
        # Half away from zero, in Fraction arithmetic. Python's round() is
        # banker's rounding, so a thirty-second would land on 0 rather than a
        # sixteenth, and float() would be a float in a module whose whole point
        # is that there are none.
        log.warning("measurement %s is finer than a sixteenth; rounding", value)
        sign = -1 if scaled < 0 else 1
        magnitude = abs(scaled)
        whole = magnitude.numerator // magnitude.denominator
        if magnitude - whole >= Fraction(1, 2):
            whole += 1
        return sign * whole
    return int(scaled)


def from_sixteenths(count: int | None) -> Fraction | None:
    return None if count is None else Fraction(count, SIXTEENTHS)


def _text(value: Fraction | None) -> str:
    return "" if value is None else format_measurement(value)


# ------------------------------------------------------------------- mapping
def _apply(job: Job, row: Inspection) -> Inspection:
    """Copy the live job onto its row. One direction only."""
    row.filename = job.filename
    row.style_no = job.style_no
    row.announced_style_no = job.announced_style_no
    row.graded_style_no = job.graded_style_no
    row.state = job.status
    row.message = job.message
    row.error = job.error
    row.form = job.form or {}
    row.sizes = list(job.sizes or [])
    row.outputs = {kind: str(path) for kind, path in (job.files or {}).items()}
    row.rows = job.rows
    row.judged = job.judged
    row.flagged = job.flagged
    row.out_of_tolerance = job.out_of_tolerance
    row.unconfirmed = job.unconfirmed
    row.accessories = job.accessories
    row.comments = job.comments
    row.graded = job.graded
    row.measurement_result = job.measurement_result
    if job.status in (DONE, FAILED) and row.finished_at is None:
        row.finished_at = datetime.now(UTC)
    return row


def _revive(row: Inspection) -> Job:
    """Rebuild the in-memory job from its row.

    The detail lists (`flagged_rows` and the rest) are not restored: they are
    a rendering of the saved extraction, they are capped for display anyway,
    and the report endpoints rebuild them from the document on demand. What
    has to survive is the state, the counts and where the outputs went.
    """
    job = Job(id=row.id, filename=row.filename, style_no=row.style_no)
    job.status = row.state
    job.message = row.message
    job.error = row.error
    job.form = dict(row.form or {})
    job.sizes = list(row.sizes or [])
    job.files = {kind: Path(path) for kind, path in (row.outputs or {}).items()}
    job.rows = row.rows
    job.judged = row.judged
    job.flagged = row.flagged
    job.out_of_tolerance = row.out_of_tolerance
    job.unconfirmed = row.unconfirmed
    job.accessories = row.accessories
    job.comments = row.comments
    job.graded = row.graded
    job.measurement_result = row.measurement_result
    job.announced_style_no = row.announced_style_no
    job.graded_style_no = row.graded_style_no
    job.started_at = row.started_at.timestamp()
    job.finished_at = row.finished_at.timestamp() if row.finished_at else 0.0

    # A job that was mid-flight when the process died is not still running.
    # Saying so is the honest state and the only one somebody can act on.
    if job.status in ("queued", "running"):
        job.status = FAILED
        job.error = (
            "The server restarted while this inspection was being processed. "
            "Nothing was written. Process the recording again."
        )
        job.message = "interrupted by a restart"
    return job


# ----------------------------------------------------------------- the store
class DatabaseJobStore(JobStore):
    """A job registry that writes through to the database.

    Subclasses the in-memory store rather than replacing it: the dictionary
    stays the working copy the pipeline mutates, and every call that changes
    something durable is mirrored to a row. Reads stay in memory, so polling
    the status endpoint four times a second does not become four queries.
    """

    def __init__(self, stage: str = Stage.sizeset.value) -> None:
        super().__init__()
        self.stage = stage
        self.load()

    def load(self) -> None:
        """Bring back everything the last process left behind."""
        with session() as db:
            rows = db.scalars(
                select(Inspection)
                .where(Inspection.stage == self.stage)
                .order_by(Inspection.created_at)
            ).all()
            revived = [(_revive(row), row) for row in rows]
            for job, row in revived:
                # An interrupted job is written back, not just relabelled in
                # memory: the next restart must not resurrect it as running.
                if row.state != job.status:
                    _apply(job, row)
        with self._lock:
            for job, _ in revived:
                self._jobs[job.id] = job
        if revived:
            log.info("recovered %d inspection(s) from the database", len(revived))

    def create(self, filename: str, style_no: str = "") -> Job:
        job = super().create(filename, style_no=style_no)
        with session() as db:
            db.add(_apply(job, Inspection(id=job.id, stage=self.stage)))
        return job

    def save(self, job: Job) -> None:
        """Write the job's current state down. Safe to call often."""
        with session() as db:
            row = db.get(Inspection, job.id)
            if row is None:
                row = Inspection(id=job.id, stage=self.stage)
                db.add(row)
            _apply(job, row)

    def record_recording(self, job: Job, key: str, sha256: str = "") -> None:
        """Note where the audio is and what it hashes to."""
        with session() as db:
            row = db.get(Inspection, job.id)
            if row is None:
                return
            row.recording_key = key
            if sha256:
                row.content_sha256 = sha256

    def record_extraction(self, job: Job, extraction: dict) -> None:
        """Store the document every output is rebuilt from."""
        with session() as db:
            row = db.get(Inspection, job.id)
            if row is None:
                return
            row.extraction = extraction
            row.schema_version = 1


# ------------------------------------------------------------------ readings
def rebuild_readings(db: Session, inspection_id: str, grid: dict) -> int:
    """Replace this inspection's readings from an audit grid.

    Wholesale, not a merge: the grid is rendered from the extraction, the
    extraction is the source of truth, and reconciling two sets of rows would
    be inventing a third opinion. Returns how many rows were written.

    `grid` is exactly what `services.audit.audit_grid()` returns, which is
    what the audit screen already asks for — so nothing new has to be computed
    to keep this table current.
    """
    db.execute(delete(Reading).where(Reading.inspection_id == inspection_id))

    written = 0
    for row in grid.get("rows", []):
        if row.get("kind") == "note":
            continue
        for size, cell in (row.get("cells") or {}).items():
            if cell is None:
                continue
            spec = parse(cell.get("spec"))
            deviation = parse(cell.get("deviation"))
            measured = parse(cell.get("measured"))
            confidence = cell.get("confidence")
            db.add(
                Reading(
                    inspection_id=inspection_id,
                    sheet_index=row.get("sheet_index", 0),
                    row_number=cell.get("row"),
                    pom=row.get("pom", ""),
                    description=row.get("description", ""),
                    size=size,
                    spec_text=_text(spec),
                    spec_sixteenths=to_sixteenths(spec),
                    deviation_text=_text(deviation),
                    deviation_sixteenths=to_sixteenths(deviation),
                    measured_text=_text(measured),
                    measured_sixteenths=to_sixteenths(measured),
                    verdict=str(cell.get("verdict") or ""),
                    state=str(cell.get("state") or "empty"),
                    confidence=(
                        None if confidence is None else round(float(confidence) * 100)
                    ),
                    disputed=bool(cell.get("disputed")),
                    edited=bool(cell.get("edited")),
                )
            )
            written += 1
    return written
