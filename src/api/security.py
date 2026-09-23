"""Turning a cookie into an account, and an account into a yes or a no.

Every rule lives in `services/auth.py`; this is only the FastAPI end of it —
where the token is read from, what status code a refusal gets, and how the
cookie is set. Kept apart so that the rules can be tested without a request
and reused by the CLI, which has no cookies at all.

One rule about the shape of this file: an endpoint is protected by *declaring*
a dependency, never by remembering to call a check inside the handler. A check
that has to be remembered is a check that will be forgotten on the next
endpoint somebody adds in a hurry.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response

from services import auth
from services.db import session
from services.db.models import User

# The token lives here and only here: httpOnly, so no script can read it, which
# is the difference between an XSS bug that defaces a page and one that walks
# off with a session.
SESSION_COOKIE = "session"


def set_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=auth.SESSION_HOURS * 3600,
        httponly=True,
        # Follows the scheme actually in use, so a local http run works and a
        # deployment behind TLS gets a cookie the browser will not send in the
        # clear. A hardcoded True breaks localhost; a hardcoded False is a
        # deployment sending its session over http and nobody noticing.
        secure=request.url.scheme == "https",
        # Lax, not None: the browser withholds this on a cross-site POST, which
        # is CSRF protection without a token round trip. Nothing here is a
        # cross-site form.
        samesite="lax",
        path="/",
    )


def clear_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def current_user(request: Request) -> User:
    """Whoever is signed in. 401 if nobody is."""
    token = request.cookies.get(SESSION_COOKIE, "")
    with session() as db:
        user = auth.resolve(db, token)
        if user is None:
            raise HTTPException(status_code=401, detail="Sign in to continue.")
        # Detached deliberately: memberships are already loaded (selectin), and
        # an object still attached to a closed session is a lazy load waiting
        # to raise somewhere far from here.
        db.expunge(user)
        return user


SignedIn = Annotated[User, Depends(current_user)]


def requires(capability: str):
    """A dependency that admits only accounts holding `capability`.

    Declared in the signature, so the answer to "is this endpoint protected"
    is visible at the endpoint rather than somewhere in its body.
    """

    def check(user: SignedIn) -> User:
        if not auth.can(user, capability):
            raise HTTPException(
                status_code=403,
                detail=auth.REASONS.get(capability, "You do not have access to this."),
            )
        return user

    return Annotated[User, Depends(check)]


# The eight, spelled once. An endpoint declares one of these rather than a
# string literal, so a typo is an import error instead of an endpoint that
# quietly admits nobody — or, worse, one that admits everybody.
Records = requires("record")
ViewsAudit = requires("audit.view")
EditsAudit = requires("audit.edit")
DownloadsWorking = requires("download.working")
DownloadsVendor = requires("download.vendor")
Releases = requires("release")
ManagesStyles = requires("manage.styles")
ManagesPeople = requires("manage.people")
