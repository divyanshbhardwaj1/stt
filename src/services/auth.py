"""Who is signed in, and what they are allowed to do.

The capability names and the role split are ported verbatim from
`demo/auth.js`, deliberately and to the letter. The prototype ran every check
in the browser, which is exactly where access control must not live; the same
eight names are enforced here, and the browser's copy goes back to deciding
what to draw.

The split comes from what the documents actually are. A graded sheet is a
vendor-facing record stamped *"Subject to Legal Action if Disclosed Without
Authorization from AEO."* So:

  * the person who **records** an inspection is on the floor with a headset;
  * the person who **corrects** a misheard reading is a QA reviewer;
  * the person who **releases** it to the vendor is neither of them.

That last separation is the load-bearing one. If one account could both alter
a measurement and sign the document off, a wrong reading and its approval
would leave no trace of disagreement anywhere.

Two things here are security rather than plumbing, and are written the long
way on purpose: passwords are hashed with a memory-hard KDF and compared in
constant time, and session tokens are stored only as hashes. Both are cheap
now and unfixable later — a leaked password column cannot be un-leaked.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from .db.models import LoginSession, Membership, Role, Stage, User, UserState

log = logging.getLogger(__name__)

# Every capability, with what it means on screen. The order is the order an
# administrator reads them in.
CAPABILITIES: list[tuple[str, str]] = [
    ("record", "Record and upload inspections"),
    ("audit.view", "Open the graded sheet"),
    ("audit.edit", "Correct readings and save"),
    ("download.working", "Download working files (CSV, JSON)"),
    ("download.vendor", "Download vendor documents (PDF)"),
    ("release", "Release a report to the vendor"),
    ("manage.styles", "Manage the style set library"),
    ("manage.people", "Manage people and roles"),
]

ALL_CAPABILITIES = frozenset(name for name, _ in CAPABILITIES)

ROLES: dict[str, frozenset[str]] = {
    Role.inspector.value: frozenset({"record", "audit.view"}),
    Role.reviewer.value: frozenset(
        {"record", "audit.view", "audit.edit", "download.working"}
    ),
    # No `audit.edit`, and that is the point rather than an omission.
    Role.approver.value: frozenset(
        {"audit.view", "download.working", "download.vendor", "release"}
    ),
    Role.admin.value: ALL_CAPABILITIES,
}

ROLE_LABELS = {
    Role.inspector.value: "Inspector",
    Role.reviewer.value: "QA reviewer",
    Role.approver.value: "Approver",
    Role.admin.value: "Administrator",
}

# Why an action is unavailable, said in terms of the job rather than the
# token. "Your role lacks audit.edit" tells somebody nothing about who to go to.
REASONS = {
    "record": "Only inspectors and reviewers record inspections.",
    "audit.view": "You do not have access to graded sheets.",
    "audit.edit": (
        "Corrections are made by QA reviewers. Approvers sign off on the sheet as it "
        "stands — that separation is deliberate."
    ),
    "download.working": "Working files are for the QA team.",
    "download.vendor": "Vendor documents are released by an approver.",
    "release": "Only an approver can release a report to the vendor.",
    "manage.styles": "The style set library is managed by an administrator.",
    "manage.people": "People and roles are managed by an administrator.",
}

# The stage every inspection belongs to today. Size set is the only pipeline
# that exists (§32, phase 7 adds the rest), so a permission question that needs
# a stage is asked about this one. When a second pipeline lands, the job
# carries its own stage and this constant is what the checks stop using.
DEFAULT_STAGE = Stage.sizeset.value

# Deliberately permissive. A strict email regex is a famous way to reject
# somebody's real address — plus-addressing, new TLDs, apostrophes in a
# surname — and the only check that actually proves an address works is
# sending to it. This rejects what cannot possibly be one and gets out of the
# way. Addresses are lower-cased first: mail domains are case-insensitive, and
# two rows for one person is a split audit trail nobody notices for months.
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")

# A shift. Long enough that nobody is signed out halfway through an inspection,
# short enough that a browser left open on the floor overnight is not a way in.
# ponytail: absolute, not sliding — sliding costs a write per request, and the
# upgrade is to refresh `expires_at` only when it is more than an hour stale.
SESSION_HOURS = 12

# scrypt, at the parameters the Python docs and RFC 7914 suggest for
# interactive logins: ~16 MB of memory per hash. Memory is what makes this
# expensive to attack in parallel on a GPU, so n is the number that matters.
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_LEN = 32


class AuthError(Exception):
    """Something a person did wrong, phrased for that person."""


_DUMMY_HASH: str | None = None


def _dummy_hash() -> str:
    """A hash of a password nobody has, to check unknown accounts against.

    Built once and kept, so that signing in with an id that does not exist
    costs exactly one scrypt verification — the same as signing in with one
    that does. Hashing a throwaway password per attempt would cost two, and an
    unknown id answering measurably slower is the same enumeration oracle as a
    different error message, told by the clock instead.
    """
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(32))
    return _DUMMY_HASH


def now() -> datetime:
    return datetime.now(UTC)


# ----------------------------------------------------------------- passwords
def hash_password(password: str) -> str:
    """A verifier for `password`, salted and self-describing.

    The parameters travel with the hash so that raising them later does not
    strand every existing account: an old hash still says how to check itself.
    """
    if not password:
        raise AuthError("A password is required.")
    if len(password) < 8:
        raise AuthError("Passwords are at least 8 characters.")
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=SCRYPT_LEN,
    )
    return "$".join(
        [
            "scrypt",
            str(SCRYPT_N),
            str(SCRYPT_R),
            str(SCRYPT_P),
            base64.b64encode(salt).decode(),
            base64.b64encode(derived).decode(),
        ]
    )


def verify_password(password: str, stored: str) -> bool:
    """Whether `password` produced `stored`. False rather than raising."""
    if not password or not stored:
        return False
    try:
        scheme, n, r, p, salt, expected = stored.split("$")
        if scheme != "scrypt":
            return False
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=base64.b64decode(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(base64.b64decode(expected)),
        )
    except (ValueError, TypeError):
        # A hash this code did not write. Refuse rather than guess.
        return False
    # Constant time: a plain `==` returns faster the earlier it finds a
    # difference, which over enough attempts is the hash, one byte at a time.
    return hmac.compare_digest(derived, base64.b64decode(expected))


# ------------------------------------------------------------------ accounts
def normalise_email(value: str) -> str:
    return str(value or "").strip().lower()


def check_email(value: str) -> str:
    """A usable email address, or an explanation of why it is not one."""
    email = normalise_email(value)
    if not email:
        raise AuthError("A user needs an email address — it is what they sign in with.")
    if len(email) > 254:
        raise AuthError("That email address is too long.")
    if not EMAIL_PATTERN.match(email):
        raise AuthError(f"“{value}” does not look like an email address.")
    return email


def capabilities(user: User, stage: str = DEFAULT_STAGE) -> frozenset[str]:
    """What this user may do on this stage."""
    return ROLES.get(role_on(user, stage) or "", frozenset())


def role_on(user: User, stage: str = DEFAULT_STAGE) -> str | None:
    """Their role on one stage, or None if they hold none.

    An administrator holds every stage, including ones added after they were
    created. That is the whole reason it is a flag and not four rows.
    """
    if user.is_admin:
        return Role.admin.value
    for membership in user.memberships:
        if membership.stage == stage:
            return membership.role
    return None


def can(user: User, capability: str, stage: str = DEFAULT_STAGE) -> bool:
    return capability in capabilities(user, stage)


def stages_of(user: User) -> list[str]:
    """Every stage they can open, in pipeline order."""
    if user.is_admin:
        return [stage.value for stage in Stage]
    held = {membership.stage for membership in user.memberships}
    return [stage.value for stage in Stage if stage.value in held]


def describe(user: User, stage: str = DEFAULT_STAGE) -> dict[str, object]:
    """What the browser needs to draw the right chrome.

    It decides what to *show*; every check that matters has already been made
    on the way in. Sending the capability list is not a permission — it is a
    description of permissions the server is enforcing anyway.
    """
    role = role_on(user, stage)
    return {
        # A string, not a UUID object: this crosses JSON, and a client that
        # round-trips it has to get back what it was given.
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "admin": user.is_admin,
        "state": user.state,
        "stage": stage,
        "role": role,
        "role_label": ROLE_LABELS.get(role or "", ""),
        "stages": stages_of(user),
        "can": sorted(capabilities(user, stage)),
        "roles": {stage_name: role_on(user, stage_name) for stage_name in stages_of(user)},
    }


# ------------------------------------------------------------------ sessions
def _fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def sign_in(db, email: str, password: str, user_agent: str = "") -> tuple[User, str]:
    """Check a password and open a session. Returns the user and the token.

    Every failure says the same thing. Telling an anonymous caller that an
    address exists but the password is wrong is an account-enumeration oracle,
    and the addresses here are people's work emails.
    """
    wrong = AuthError("That email and password do not match.")
    user = db.scalar(select(User).where(User.email == normalise_email(email)))

    if user is None or not user.password_hash:
        # Check anyway, against a hash of nothing. Returning faster for an
        # unknown id than for a known one is the same oracle, told by the clock
        # instead of the message.
        verify_password(password or "x", _dummy_hash())
        raise wrong
    if not verify_password(password or "", user.password_hash):
        raise wrong
    if user.state == UserState.disabled.value:
        raise AuthError("That account has been disabled. An administrator can restore it.")
    if user.state == UserState.invited.value:
        raise AuthError(f"“{user.email}” has not set a password yet.")
    if not stages_of(user):
        raise AuthError(
            f"“{user.email}” is not on any stage yet. An administrator has to add them."
        )

    sweep(db)
    token = secrets.token_urlsafe(32)
    db.add(
        LoginSession(
            token_hash=_fingerprint(token),
            user_id=user.id,
            expires_at=now() + timedelta(hours=SESSION_HOURS),
            user_agent=(user_agent or "")[:255],
        )
    )
    user.last_seen_at = now()
    log.info("signed in: %s", user.email)
    return user, token


def resolve(db, token: str) -> User | None:
    """The user this token belongs to, or None.

    None covers every way a token can fail — absent, unknown, expired, or
    belonging to an account that has since been disabled. The caller has one
    answer to give and does not benefit from knowing which.
    """
    if not token:
        return None
    found = db.get(LoginSession, _fingerprint(token))
    if found is None:
        return None
    expires = found.expires_at
    if expires.tzinfo is None:  # SQLite hands back naive datetimes
        expires = expires.replace(tzinfo=UTC)
    if expires <= now():
        db.delete(found)
        return None
    user = found.user
    if user is None or user.state != UserState.active.value:
        # Disabling somebody takes effect on their next request, not whenever
        # the token they are holding happens to run out. That is the entire
        # argument for sessions in a table.
        return None
    return user


def sign_out(db, token: str) -> None:
    found = db.get(LoginSession, _fingerprint(token)) if token else None
    if found is not None:
        db.delete(found)


def sign_out_everywhere(db, user_id) -> int:
    """End every session for one user. Used when a password changes or a user
    is disabled — a password change that leaves old sessions alive has not
    actually locked anybody out."""
    sessions = db.scalars(select(LoginSession).where(LoginSession.user_id == user_id)).all()
    for found in sessions:
        db.delete(found)
    return len(sessions)


def sweep(db) -> int:
    """Delete expired sessions.

    ponytail: on sign-in rather than on a schedule, because there is no
    scheduler yet and it costs nothing next to the password hash that just ran.
    """
    stale = db.scalars(select(LoginSession).where(LoginSession.expires_at <= now())).all()
    for found in stale:
        db.delete(found)
    return len(stale)


# ------------------------------------------------------------------- roster
def last_admin(db, user_id) -> bool:
    """Whether removing or demoting this user leaves nobody in charge."""
    admins = db.scalars(select(User.id).where(User.is_admin.is_(True))).all()
    return len(admins) == 1 and admins[0] == user_id


def set_roles(db, user: User, roles: dict[str, str]) -> None:
    """Replace every membership with `{stage: role}`.

    Wholesale, never merged: a patch that only adds is how somebody keeps a
    role on a stage they were supposed to have been taken off.
    """
    for stage, role in roles.items():
        if stage not in {member.value for member in Stage}:
            raise AuthError(f"There is no {stage!r} stage.")
        if role not in {Role.inspector.value, Role.reviewer.value, Role.approver.value}:
            raise AuthError(
                f"{role!r} is not a role. Use inspector, reviewer or approver — "
                "an administrator is made with the admin flag, not a role."
            )
    user.memberships.clear()
    # The deletes have to reach the database before the inserts that reuse the
    # same (user, stage). SQLAlchemy orders inserts before deletes within one
    # flush, so without this, changing somebody's role on a stage they already
    # hold trips the unique constraint instead of changing anything.
    db.flush()
    user.memberships = [
        Membership(user_id=user.id, stage=stage, role=role)
        for stage, role in sorted(roles.items())
    ]


def create_user(
    db,
    email: str,
    name: str,
    *,
    password: str = "",
    roles: dict[str, str] | None = None,
    is_admin: bool = False,
) -> User:
    email = check_email(email)
    if db.scalar(select(User).where(User.email == email)) is not None:
        raise AuthError(f"“{email}” already has an account.")
    if not str(name or "").strip():
        raise AuthError("A user needs a name — it is what the audit trail records.")
    roles = roles or {}
    if not is_admin and not roles:
        raise AuthError(
            "Give them a role on at least one stage, or make them an administrator."
        )

    user = User(
        email=email,
        name=name.strip(),
        is_admin=is_admin,
        password_hash=hash_password(password) if password else "",
        state=UserState.active.value if password else UserState.invited.value,
    )
    db.add(user)
    db.flush()  # the memberships need the id, which is generated on the flush
    # An administrator holds every stage by the flag, so rows would only go
    # stale. See Role.
    set_roles(db, user, {} if is_admin else roles)
    log.info("user created: %s%s", email, " (admin)" if is_admin else "")
    return user
