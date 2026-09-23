"""A role held on one stage.

A role is always a role *in* something. The same person is routinely a
reviewer on size set and an approver on final, and collapsing that into one
global role is what makes a factory keep two logins per person — which is how
an audit trail stops being able to answer who did what.

No row for a stage means no access to that stage at all, which is a different
answer from "not allowed to do that here" and the API says so differently.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:  # pragma: no cover - for type checkers, not at runtime
    from .user import User


class Membership(Base):
    __tablename__ = "memberships"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    stage: Mapped[str] = mapped_column(String(16))
    role: Mapped[str] = mapped_column(String(16))

    user: Mapped[User] = relationship(back_populates="memberships")

    __table_args__ = (
        # One role per person per stage. Two rows would make "what may they do
        # here" a question with two answers, and the permissive one always wins
        # by accident.
        UniqueConstraint("user_id", "stage", name="uq_membership_stage"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging convenience
        return f"<Membership {self.user_id} {self.stage}:{self.role}>"
