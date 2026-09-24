"""The schema: one table per file.

Every model is imported here whether or not the caller asks for it, and that
is the point rather than an oversight. `Base.metadata` is only as complete as
the classes that have been imported, so Alembic's autogenerate would silently
miss a table nobody happened to import — a missing table is a migration that
looks clean and drops nothing, which is the worst kind.

Adding a table: a new module beside these, and a line below.
"""

from .base import Base, JSONish, utcnow
from .enums import Role, Stage, State, UserState
from .event import Event
from .inspection import Inspection
from .membership import Membership
from .reading import Reading
from .session import LoginSession
from .user import User

__all__ = [
    "UserState",
    "Base",
    "Event",
    "Inspection",
    "JSONish",
    "LoginSession",
    "Membership",
    "Reading",
    "Role",
    "Stage",
    "State",
    "User",
    "utcnow",
]
