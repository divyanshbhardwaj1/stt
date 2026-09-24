"""The audit trail: one row per thing a person did.

Append-only. Nothing in the application updates or deletes a row here, and
that is the whole value of the table — a log that can be tidied up is a log
nobody can rely on when a vendor disputes a measurement eight months later.

**Machine steps are not events.** Transcription starting, the pipeline
finishing, a file being written: those are the inspection's own state and the
`inspections` table already carries them. What goes here is attributable —
somebody signed in, and did it. That line keeps the trail readable instead of
burying four corrections in two hundred progress notices.

`actor` is a snapshot of the name and `user_id` is the pointer. Both, because
they answer different questions. The pointer survives a rename and groups
correctly; the snapshot survives the user being deleted, which is exactly the
case where the trail matters most and `ON DELETE SET NULL` would otherwise
leave a row that says somebody did something.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utcnow


class Event(Base):
    """One attributable action."""

    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    # Who. See the module docstring for why this is two columns.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor: Mapped[str] = mapped_column(String(128), default="")

    # What kind of thing. Separated because the questions asked of a log are
    # different: "who changed a measurement" is an audit question and "who
    # downloaded the vendor PDF" is an access one.
    kind: Mapped[str] = mapped_column(String(16), default="access", index=True)
    stage: Mapped[str] = mapped_column(String(16), default="sizeset", index=True)

    # The sentence, written at the call site where the detail is still known.
    what: Mapped[str] = mapped_column(String(300), default="")
    # What it was done to - an inspection label, a style number, a person.
    subject: Mapped[str] = mapped_column(String(64), default="")

    __table_args__ = (Index("ix_events_stage_at", "stage", "at"),)

    def __repr__(self) -> str:  # pragma: no cover - debugging only
        return f"<Event {self.kind} {self.actor}: {self.what}>"
