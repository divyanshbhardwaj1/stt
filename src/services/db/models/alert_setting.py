"""Where a floor differs from what a rule does out of the box.

The catalogue of rules is in `services/alerts.py`, because each one has to
understand what a tolerance band is and what an unanswered point of measure
means. An administrator cannot invent a rule from a settings page — that is a
query builder, and a query builder is a product of its own. What they can do is
turn one off, move its threshold, and choose how it reaches people.

Who it reaches is not a setting. Every alert goes to the administrators, whose
addresses the roster already holds — one answer, always true, and nothing to
keep in step when somebody changes job.

Only the differences are stored, and a column left null means "whatever the
rule says". That is what keeps a floor on the defaults actually on them: change
a threshold in code and it reaches everybody who never touched that rule, which
is the whole point of shipping a default in the first place.
"""

from __future__ import annotations

from sqlalchemy import Boolean, Float, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class AlertSetting(Base):
    """One rule's policy on one stage."""

    __tablename__ = "alert_settings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # Matches `Rule.key` in the catalogue. A row whose rule the product no
    # longer has is ignored rather than cleaned up: harmless, and deleting it
    # would throw away a setting somebody made if the rule came back.
    rule: Mapped[str] = mapped_column(String(48), index=True)
    stage: Mapped[str] = mapped_column(String(16), default="sizeset")

    enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Always hours, whatever the page shows. Two thresholds that cannot be
    # compared are two thresholds nobody can reason about.
    threshold_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Which ways out this rule may use: "inapp", "email", or both, comma
    # separated. Empty means the rule's own default. Stored as a string rather
    # than two booleans so a third channel is a value and not a migration.
    channels: Mapped[str] = mapped_column(String(64), default="")

    __table_args__ = (UniqueConstraint("rule", "stage", name="uq_alert_setting"),)

    def __repr__(self) -> str:  # pragma: no cover - debugging only
        return f"<AlertSetting {self.rule}@{self.stage}>"
