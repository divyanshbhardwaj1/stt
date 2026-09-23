"""What every table shares.

Kept apart from the tables themselves so a model file imports the base and
nothing else — the moment `base.py` imports a model, adding a table means
untangling a cycle.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase

# JSONB where the deployment has it, plain JSON where the tests run. Same
# Python type either way; only Postgres can index inside it.
JSONish = JSON().with_variant(postgresql.JSONB(), "postgresql")


def utcnow() -> datetime:
    """Now, with an offset on it.

    Naive datetimes and timezone-aware ones compare badly and silently, and a
    timestamp on an inspection is evidence about when somebody measured
    something. Everything here is UTC and says so.
    """
    return datetime.now(UTC)


class Base(DeclarativeBase):
    """The declarative base every table inherits.

    One registry, so `Base.metadata` is the whole schema and Alembic's
    autogenerate sees every table — which is why `models/__init__.py` imports
    all of them whether or not the caller asked for them.
    """
