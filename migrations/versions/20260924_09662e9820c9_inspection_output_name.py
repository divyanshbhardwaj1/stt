"""inspection output name

What every output of an inspection is called — `<name>.pdf`, `<name>.json` and
the rest — and therefore how the saved extraction is found again.

It was missing, and the gap only opened after a restart: a job revived from
this table came back with an empty name, so the audit view went looking for
`.json` and answered 410 for a report sitting on disk the whole time.

Existing rows are backfilled rather than left blank. `outputs` already holds
the full path of every file this inspection produced, so the name is the stem
of any one of them — no guessing, and no row left unreadable.
"""
import json
from collections.abc import Sequence
from pathlib import PurePosixPath

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '09662e9820c9'
down_revision: str | Sequence[str] | None = 'b08425f66127'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Added with a server default so the NOT NULL holds on a table that already
    # has rows; the default is dropped again below, because the application
    # always supplies the value and a default here would hide a future gap.
    op.add_column(
        "inspections",
        sa.Column("name", sa.String(length=255), nullable=False, server_default=""),
    )

    # Backfill from `outputs`, which maps each kind to the file it was written
    # to. Every one of them is named for the inspection, so the stem of any is
    # the name. Done in Python rather than SQL: the column is JSON on SQLite
    # and JSONB on Postgres, and one loop is cheaper than two dialects of the
    # same query.
    rows = op.get_bind().execute(
        sa.text("SELECT id, outputs FROM inspections WHERE name = ''")
    ).fetchall()
    for inspection_id, outputs in rows:
        if isinstance(outputs, str):
            outputs = json.loads(outputs or "{}")
        paths = list((outputs or {}).values())
        if not paths:
            continue
        op.get_bind().execute(
            sa.text("UPDATE inspections SET name = :name WHERE id = :id"),
            {"name": PurePosixPath(str(paths[0]).replace("\\", "/")).stem, "id": inspection_id},
        )

    op.alter_column("inspections", "name", server_default=None)


def downgrade() -> None:
    op.drop_column("inspections", "name")
