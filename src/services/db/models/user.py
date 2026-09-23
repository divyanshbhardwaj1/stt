"""One person who can sign in.

**The primary key is a UUID, and the login credential is an email.** Those are
two separate facts and keeping them separate is the point.

An earlier version of this table used the login name as the primary key, on
the argument that the audit trail records it and "settled by s.iqbal" should
keep meaning something. That argument was backwards. A credential is exactly
the thing that changes — people marry, a domain gets bought, somebody was
entered wrong on their first day — and a key that changes has to be chased
through every row that points at it. A surrogate key never changes, so the
audit trail keeps pointing at the same person no matter what they are called
this year. The name to print is looked up, not stored in the pointer.

Emails are stored lower case and unique. `S.Iqbal@…` and `s.iqbal@…` signing
in as two different people is a split audit trail nobody notices for months,
and mail domains are case-insensitive anyway.

Users are disabled, never deleted, once they have done anything. A finished
inspection points at whoever recorded and settled it, and that pointer has to
survive the person leaving.

The password hash lives here and nowhere else. It is empty for an `invited`
user, which is a real state rather than a missing value: the user exists, it
holds roles, and it cannot be signed in to until somebody sets a password.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow
from .enums import UserState

if TYPE_CHECKING:  # pragma: no cover - for type checkers, not at runtime
    from .membership import Membership
    from .session import LoginSession


class User(Base):
    __tablename__ = "users"

    # `Uuid` is native on Postgres and CHAR(32) on SQLite, so the same model
    # runs against the deployment and against a test file in tmp_path without
    # a dialect branch anywhere.
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    # The credential. Unique, lower case, and the only thing typed at sign-in
    # besides the password.
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    # scrypt, salted per user. Empty while the user is `invited`.
    password_hash: Mapped[str] = mapped_column(String(255), default="")
    state: Mapped[str] = mapped_column(String(16), default=UserState.invited.value)

    # Not a role on four stages — the absence of the question. See Role.
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Written at most once per sign-in, not on every request: this is for an
    # administrator looking at a roster, not a session clock.
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    memberships: Mapped[list[Membership]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",  # every permission check reads them; never lazily, one by one
    )
    sessions: Mapped[list[LoginSession]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        # 254 is the longest an email address can be, and the unique index is
        # the sign-in lookup as well as the constraint.
        Index("ix_users_email", "email", unique=True),
        # The roster screen is "everyone, by name"; administrators are asked for
        # separately whenever the last-administrator rule is checked.
        Index("ix_users_admin", "is_admin"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging convenience
        return f"<User {self.email} {self.state}{' admin' if self.is_admin else ''}>"
