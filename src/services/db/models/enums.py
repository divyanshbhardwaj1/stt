"""The small closed sets, in one place because more than one table reads them."""

from __future__ import annotations

import enum


class Stage(enum.StrEnum):
    """The four checks a garment passes, in order.

    Stored as a string column rather than a database enum: adding a stage
    should be a deploy, not a migration that takes a lock on every table
    referencing the type.
    """

    sizeset = "sizeset"
    ppm = "ppm"
    interim = "interim"
    final = "final"


class State(enum.StrEnum):
    """Where an inspection is. The same four words the API already reports."""

    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"


class Role(enum.StrEnum):
    """What somebody may do on one stage.

    The three working roles are a separation of duties, not a seniority
    ladder: whoever signs a document off must not also be able to quietly
    change what it says first. So the person who records, the person who
    corrects a misheard reading, and the person who releases the report to the
    vendor are three different people.

    `admin` is here because the capability table needs a row for it, but it is
    never stored in `memberships` — an administrator holds every stage by a
    flag on the account. Four rows per administrator is a list that goes stale
    the first time a fifth stage exists, and a floor with an administrator who
    cannot see a stage is a floor with a stage nobody can fix.
    """

    inspector = "inspector"
    reviewer = "reviewer"
    approver = "approver"
    admin = "admin"


class UserState(enum.StrEnum):
    """Whether a user can sign in.

    `invited` is the state a user is created in: they exist, they hold roles,
    and they have no password yet. Distinct from `disabled`, which is somebody
    who could sign in and no longer may — the audit trail has to keep pointing
    at a person who has left, so users are disabled, never deleted out from
    under the record.
    """

    invited = "invited"
    active = "active"
    disabled = "disabled"
