"""One recording, from arrival to finished report.

`extraction` is the SOURCE OF TRUTH for everything downstream. It is the same
JSON the pipeline already writes to `data/output/<name>.json`, and every output
is rebuilt from it: `audit.settle()` and `regrade_size()` both work by editing
that document and re-rendering the report, the graded sheet and all four CSVs.
Exploding it into columns and editing those instead would leave two things that
have to agree, and eventually will not.

The counts beside it are denormalised on purpose. The register renders a
hundred rows at a time and should not aggregate `readings` a hundred times to
do it — they are a summary of the same document, rewritten whenever it is.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, JSONish, utcnow
from .enums import Stage, State

if TYPE_CHECKING:  # pragma: no cover - for type checkers, not at runtime
    from .reading import Reading


class Inspection(Base):
    __tablename__ = "inspections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    stage: Mapped[str] = mapped_column(String(16), default=Stage.sizeset.value)

    filename: Mapped[str] = mapped_column(String(255))
    # The style the operator chose at upload. Empty means "use whatever the
    # recording announces", which is not the same as "none" and has to survive
    # a restart or a re-run grades against a different sheet.
    style_no: Mapped[str] = mapped_column(String(32), default="")
    announced_style_no: Mapped[str] = mapped_column(String(32), default="")
    graded_style_no: Mapped[str] = mapped_column(String(32), default="")

    state: Mapped[str] = mapped_column(String(16), default=State.queued.value)
    message: Mapped[str] = mapped_column(String(255), default="waiting to start")
    error: Mapped[str] = mapped_column(Text, default="")

    # Where the audio actually is. A key, not a path: today it resolves under
    # `data/recordings`, and the same column holds an S3 key once it moves.
    recording_key: Mapped[str] = mapped_column(String(512), default="")
    # Content hash, so re-uploading the same recording is recognised rather
    # than transcribed again at full price.
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duration_s: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Versioned from the first row, so a later change of shape can be migrated
    # by version rather than guessed at.
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    extraction: Mapped[dict | None] = mapped_column(JSONish, nullable=True)
    # Summaries of `extraction`, kept beside it because the job list needs them
    # without loading the whole document.
    form: Mapped[dict | None] = mapped_column(JSONish, nullable=True)
    outputs: Mapped[dict | None] = mapped_column(JSONish, nullable=True)
    sizes: Mapped[list | None] = mapped_column(JSONish, nullable=True)

    rows: Mapped[int] = mapped_column(Integer, default=0)
    judged: Mapped[int] = mapped_column(Integer, default=0)
    flagged: Mapped[int] = mapped_column(Integer, default=0)
    out_of_tolerance: Mapped[int] = mapped_column(Integer, default=0)
    unconfirmed: Mapped[int] = mapped_column(Integer, default=0)
    accessories: Mapped[int] = mapped_column(Integer, default=0)
    comments: Mapped[int] = mapped_column(Integer, default=0)
    graded: Mapped[bool] = mapped_column(default=False)
    measurement_result: Mapped[str] = mapped_column(String(64), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    readings: Mapped[list[Reading]] = relationship(
        back_populates="inspection",
        cascade="all, delete-orphan",
        # The database owns the cascade. Letting the ORM load every child row
        # in order to delete it is a query per inspection for nothing.
        passive_deletes=True,
    )

    __table_args__ = (
        # The register is always "this stage, newest first".
        Index("ix_inspections_stage_created", "stage", "created_at"),
        # A worker asks for queued work; this keeps that off a sequential scan
        # once the table is long.
        Index("ix_inspections_state", "state"),
        Index("ix_inspections_sha", "content_sha256"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging convenience
        return f"<Inspection {self.id} {self.filename} {self.state}>"
