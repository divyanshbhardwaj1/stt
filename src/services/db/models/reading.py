"""One point of measure at one size, as the graded sheet has it.

DERIVED from `Inspection.extraction` and rebuilt from it wholesale on every
write — nothing edits a row here directly. An edit goes to the extraction and
the rebuild follows, which is the only way the two can be guaranteed to agree.

The table exists because the register and anything resembling a statistic are
SQL questions: "how many readings on this floor still have no verdict" should
not mean loading and parsing several hundred JSON documents.

Measurements are stored twice on purpose. `*_text` is the printed form
("11 5/8") and is what a person reads back; `*_sixteenths` is the same value as
an integer, for sorting, filtering and aggregation. No float goes near this
table: every value on these sheets is a binary fraction, the pipeline is
`fractions.Fraction` end to end, and a NUMERIC column that round-trips through
a float in the driver is how a sixteenth quietly goes missing in a document a
vendor is holding.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:  # pragma: no cover - for type checkers, not at runtime
    from .inspection import Inspection


class Reading(Base):
    __tablename__ = "readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inspection_id: Mapped[str] = mapped_column(
        ForeignKey("inspections.id", ondelete="CASCADE"), index=True
    )

    # Position on the style sheet, which is the only stable identity a reading
    # has: POM codes repeat across shell and lining rows, and report numbers
    # shift whenever a settled row is inserted ahead of them.
    sheet_index: Mapped[int] = mapped_column(Integer)
    row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pom: Mapped[str] = mapped_column(String(32), default="")
    description: Mapped[str] = mapped_column(String(255), default="")
    size: Mapped[str] = mapped_column(String(16))

    spec_text: Mapped[str] = mapped_column(String(32), default="")
    spec_sixteenths: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deviation_text: Mapped[str] = mapped_column(String(32), default="")
    deviation_sixteenths: Mapped[int | None] = mapped_column(Integer, nullable=True)
    measured_text: Mapped[str] = mapped_column(String(32), default="")
    measured_sixteenths: Mapped[int | None] = mapped_column(Integer, nullable=True)

    verdict: Mapped[str] = mapped_column(String(32), default="")
    # pass | fail | unconfirmed | empty — what the cell shows on the sheet.
    state: Mapped[str] = mapped_column(String(16), default="empty")
    # Percent, 0-100, as an integer. Confidence is reported to the percent and
    # a float here would buy nothing but rounding arguments.
    confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The recording contradicts this measurement: the absolute read aloud
    # matches neither the spec nor spec + deviation.
    disputed: Mapped[bool] = mapped_column(default=False)
    # Settled by hand rather than heard. Who did it lands here once there is a
    # member to point at.
    edited: Mapped[bool] = mapped_column(default=False)

    inspection: Mapped[Inspection] = relationship(back_populates="readings")

    __table_args__ = (
        UniqueConstraint("inspection_id", "sheet_index", "size", name="uq_reading_cell"),
        # "What on this floor still has no verdict" is the query the review
        # queue is built from.
        Index("ix_readings_state", "inspection_id", "state"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging convenience
        return f"<Reading {self.pom} {self.size} {self.measured_text or '—'}>"
