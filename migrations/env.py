"""Alembic's entry point.

Two departures from the generated file, both deliberate:

  * The URL comes from `DATABASE_URL`, not from alembic.ini. A connection
    string is a secret in every environment that matters, and a secret checked
    into a file beside the code is a secret.
  * `compare_type` is on. Without it a column that changes from String(32) to
    String(64) autogenerates an empty migration, which is worse than no
    migration because it looks like there was nothing to do.
"""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# `src` is the import root everywhere else in this project; Alembic runs from
# the repository root and would not otherwise find it.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from services.config.settings import load_env_file  # noqa: E402
from services.db.models import Base  # noqa: E402

# Read .env the way the application does. A connection string carries a
# password, and the alternative is typing it into a shell — where it lands in
# the history file, the terminal scrollback and any recording of the session.
load_env_file()

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        raise SystemExit(
            "DATABASE_URL is not set. Put it in .env (which is gitignored) "
            "rather than passing it on the command line; Alembic reads that "
            "file the same way the application does. It is deliberately not "
            "stored in alembic.ini."
        )
    return url


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running it.

    Useful when a DBA applies the change, and the only way to review a
    migration against a production schema without holding a connection to it.
    """
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = _url()
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            # Server defaults differ enough between dialects that autogenerate
            # reports differences that are not differences. Compare them by
            # hand when one actually changes.
            compare_server_default=False,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
