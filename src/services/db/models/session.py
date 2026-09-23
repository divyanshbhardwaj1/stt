"""One signed-in browser.

Opaque random tokens in a table, not signed tokens carrying claims. The whole
reason is revocation: an administrator disabling somebody at 14:00 means they
are out at 14:00, not whenever a token they still hold happens to expire. That
requires the server to be asked, which means a row, which means the row may as
well be the token.

**Only the hash of the token is stored.** The token itself exists in the
browser's cookie and nowhere else. A database dump, a backup on somebody's
laptop, or a stray log line therefore cannot be replayed as a session — which
is the same argument as the password column beside it, for the same reason.

The class is `LoginSession` rather than `Session` because this codebase
already has two other things called that: SQLAlchemy's `Session` and the
`session()` context manager in `db/session.py`. Three of them in one import
list is a bug waiting for a tired afternoon.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow

if TYPE_CHECKING:  # pragma: no cover - for type checkers, not at runtime
    from .user import User


class LoginSession(Base):
    __tablename__ = "sessions"

    # sha256 of the cookie value, hex. The primary key, so looking a session up
    # is the same operation as proving it exists.
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # What asked for it. Not identification — a user agent is trivially
    # forged — but when somebody says "I did not do that", knowing the session
    # came from a phone rather than the floor terminal is where looking starts.
    user_agent: Mapped[str] = mapped_column(String(255), default="")

    user: Mapped[User] = relationship(back_populates="sessions")

    __table_args__ = (
        # Expired rows are swept on sign-in rather than by a scheduled job:
        # there is no scheduler yet, and the sweep is cheap next to the
        # password hash that just ran.
        Index("ix_sessions_expires", "expires_at"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging convenience
        return f"<LoginSession {self.user_id} until {self.expires_at:%Y-%m-%d %H:%M}>"
