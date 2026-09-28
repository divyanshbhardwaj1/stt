"""Something that needs attention, raised once and closed when it is dealt with.

An alert is not a dashboard figure. The dashboard answers "what is true now"
and you have to go and look at it; an alert answers "what changed that nobody
has dealt with" and it comes to you. The difference is this table: identity,
and a lifecycle.

`key` is what makes it work. It is derived from the rule and its subject -
`unanswered_stale:a4ee9af15e05` - and it is stable, so a sweep that runs every
few minutes upserts the same row rather than raising the same problem again.
Without it a system evaluated every five minutes raises two hundred and
eighty-eight copies of one stuck inspection per day, and everybody turns it
off inside a week.

Two severities, deliberately. `act` means work is blocked or at risk, `notice`
means it is on the record. Nobody calibrates five levels consistently, and the
moment they do not, severity stops carrying information.

`needs` is a capability, not a list of people. The alert is addressed to the
job - whoever can correct a sheet gets the ones about corrections - so it
survives somebody leaving, follows a promotion with nothing to update, and
cannot tell an approver to go and edit a measurement they are not allowed to
touch.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utcnow


class Alert(Base):
    """One live, or once-live, condition."""

    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # rule + subject. Unique among the live rows, not among all of them: a
    # condition that comes back deserves a new row, so the history reads as
    # what happened rather than as one row that kept changing its mind.
    key: Mapped[str] = mapped_column(String(128), index=True)
    rule: Mapped[str] = mapped_column(String(48), index=True)

    stage: Mapped[str] = mapped_column(String(16), default="sizeset", index=True)
    severity: Mapped[str] = mapped_column(String(8), default="act")
    needs: Mapped[str] = mapped_column(String(24), default="audit.view")

    # What it is about. A job id today; a style number or a user later.
    subject_id: Mapped[str] = mapped_column(String(64), default="")
    # Written where the detail is still known, and never recomputed for
    # display: an alert has to still make sense after the thing it describes
    # has been fixed.
    title: Mapped[str] = mapped_column(String(200), default="")
    detail: Mapped[str] = mapped_column(Text, default="")

    raised_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # "" while live, then "gone" when the condition stopped being true, or
    # "dismissed" when somebody decided it did not matter.
    resolution: Mapped[str] = mapped_column(String(16), default="")
    # Set on a dismissed row once the condition it covered has actually gone.
    #
    # A dismissal has to hold, or it does nothing: the sweep would raise the
    # same stuck inspection again a minute later. So a dismissal suppresses its
    # key until the condition clears on its own, and this is the moment that
    # happened — after which the same thing going wrong again raises a new row.
    # Kept as its own column rather than by rewriting `resolution`, because who
    # dismissed what is the part of this table worth keeping.
    cleared_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # One live row per key. Partial, so the resolved history does not block
        # the same condition being raised again next week.
        Index(
            "uq_alert_live",
            "key",
            unique=True,
            postgresql_where=resolved_at.is_(None),
            sqlite_where=resolved_at.is_(None),
        ),
        Index("ix_alerts_open", "stage", "resolved_at"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging only
        return f"<Alert {self.key} {'live' if self.resolved_at is None else self.resolution}>"
