"""Writing the audit trail.

One function, called at the point where something attributable happens. It
opens its own session and swallows its own failures: a trail that can take a
request down with it is a trail somebody disables.

ponytail: no queue, no buffering. One INSERT per action a person takes, which
on this application is a handful a minute.
"""

from __future__ import annotations

import logging

from .db import enabled, session
from .db.models import Event

log = logging.getLogger(__name__)

# The kinds the Activity screen groups by. Not an enum on the column: a log
# that refuses to record something because the kind was not in a list is worse
# than one that records it under a name nobody filters on.
RECORD = "record"
CORRECTION = "correction"
ACCESS = "access"
APPROVAL = "approval"
RELEASE = "release"


def record(
    user,
    kind: str,
    what: str,
    *,
    subject: str = "",
    stage: str = "sizeset",
) -> None:
    """Write one line of the trail. Never raises."""
    if not enabled():
        return
    try:
        with session() as db:
            db.add(
                Event(
                    user_id=getattr(user, "id", None),
                    actor=getattr(user, "name", "") or getattr(user, "email", ""),
                    kind=kind,
                    stage=stage,
                    what=what[:300],
                    subject=subject[:64],
                )
            )
    except Exception:  # noqa: BLE001 - the action itself already succeeded
        log.warning("could not write the audit trail: %s", what)
