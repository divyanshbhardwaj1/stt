"""Getting a database session, and deciding whether there is one at all.

The database is optional for now, and deliberately so: the pipeline, the
grading and every test in `tests/` work without one, and making Postgres a
hard requirement to run the app would have turned a schema change into a
change to 341 tests. `DATABASE_URL` unset means the app keeps the in-memory
job registry it has always had; set means jobs survive a restart.

That switch is temporary scaffolding for phase 1, not an architecture. Once
uploads, members and the audit trail all live in the database there is nothing
useful the app can do without one, and this should collapse to a hard failure
at startup.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .models import Base

log = logging.getLogger(__name__)

_engine: Engine | None = None
_Session: sessionmaker[Session] | None = None


def database_url() -> str:
    """Where the database is, or "" for none.

    Read from the environment rather than `Settings` because Alembic needs it
    without constructing the whole application config — and because a
    connection string is the one setting that also has to be available to a
    migration running in CI with no OpenAI key in sight.
    """
    return os.getenv("DATABASE_URL", "").strip()


def configure(url: str | None = None, *, echo: bool = False) -> Engine | None:
    """Open the connection pool. Returns None when no database is configured."""
    global _engine, _Session
    url = url if url is not None else database_url()
    if not url:
        return None
    if _engine is not None:
        return _engine

    _engine = create_engine(
        url,
        echo=echo,
        # The worker and the web process both hold connections, and a pooled
        # connection that has been idle through a database restart fails on
        # first use rather than reconnecting. Checking it costs a round trip
        # per checkout and saves a class of error nobody can reproduce.
        pool_pre_ping=True,
        future=True,
    )
    if _engine.dialect.name == "sqlite":
        # SQLite ignores foreign keys unless asked, per connection — so
        # ON DELETE CASCADE silently does nothing and an inspection deleted in
        # a test leaves its readings behind. Postgres needs no such reminder;
        # this exists so the tests exercise the same referential behaviour the
        # deployment has, rather than a looser one that passes either way.
        @event.listens_for(_engine, "connect")
        def _enforce_foreign_keys(connection, _record):  # pragma: no cover - trivial
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    _Session = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    log.info("database configured: %s", _engine.url.render_as_string(hide_password=True))
    return _engine


def engine() -> Engine | None:
    return _engine if _engine is not None else configure()


def enabled() -> bool:
    return engine() is not None


@contextmanager
def session() -> Iterator[Session]:
    """A transaction. Commits on the way out, rolls back on the way through.

    Callers get one unit of work and no opinion about what happens after it —
    a session left open across a pipeline stage is a connection held for eight
    minutes and a lock held with it.
    """
    if engine() is None or _Session is None:
        raise RuntimeError("no database is configured (DATABASE_URL is unset)")
    db = _Session()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def create_all() -> None:
    """Create the schema directly, without Alembic.

    For tests and a throwaway local database only. A real deployment runs
    `alembic upgrade head`, because that is the only path that also knows how
    to get from the schema you have to the schema you want.
    """
    target = engine()
    if target is None:
        raise RuntimeError("no database is configured (DATABASE_URL is unset)")
    Base.metadata.create_all(target)


def reset() -> None:
    """Forget the pool. Tests use this to swap databases between cases."""
    global _engine, _Session
    if _engine is not None:
        _engine.dispose()
    _engine, _Session = None, None
