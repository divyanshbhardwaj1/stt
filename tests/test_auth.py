"""Accounts, sessions and permissions.

The tests worth reading here are the ones about what somebody *cannot* do. A
permission system is only ever wrong in one direction that matters, and a
suite that checks the happy path for every role has verified nothing.
"""

from __future__ import annotations

import uuid
from contextlib import ExitStack
from datetime import timedelta

import pytest
from sqlalchemy import select

from services import auth
from services.db.models import Role, Stage, User, UserState

from .conftest import TEST_EMAIL, TEST_PASSWORD

FLOOR_PASSWORD = "floor-password"


@pytest.fixture
def sign_in_as(settings, app_db):
    """Make a user with a given role, and return a client signed in as it."""
    from fastapi.testclient import TestClient

    from api import app as api
    from services.db import session

    api.app.dependency_overrides[api.settings_dependency] = lambda: settings
    made = 0
    with ExitStack() as stack:

        def make(role: str | None = None, *, admin: bool = False, roles=None):
            nonlocal made
            made += 1
            email = f"floor{made}@example.com"
            with session() as db:
                created = auth.create_user(
                    db,
                    email,
                    f"Floor {made}",
                    password=FLOOR_PASSWORD,
                    roles=roles if roles is not None else ({"sizeset": role} if role else {}),
                    is_admin=admin,
                )
                user_id = str(created.id)
            client = stack.enter_context(TestClient(api.app))
            opened = client.post(
                "/api/session", json={"email": email, "password": FLOOR_PASSWORD}
            )
            assert opened.status_code == 200, opened.text
            client.user_id = user_id
            client.email = email
            return client

        yield make
    api.app.dependency_overrides.clear()


# ----------------------------------------------------------------- passwords
def test_a_password_round_trips():
    stored = auth.hash_password("a good long password")

    assert auth.verify_password("a good long password", stored) is True
    assert auth.verify_password("a good long passwore", stored) is False
    assert auth.verify_password("", stored) is False


def test_the_same_password_hashes_differently_every_time():
    """Salted. Two people with the same password must not share a hash, or a
    leaked column tells you who to try first."""
    assert auth.hash_password("identical password") != auth.hash_password("identical password")


def test_the_plaintext_is_nowhere_in_the_hash():
    assert "hunter22two" not in auth.hash_password("hunter22two")


def test_a_short_password_is_refused():
    with pytest.raises(auth.AuthError, match="8 characters"):
        auth.hash_password("short")


def test_a_hash_this_code_did_not_write_is_refused():
    """Refuse rather than guess. A stored value in an unknown format is not a
    password to be checked leniently."""
    assert auth.verify_password("anything", "md5$deadbeef") is False
    assert auth.verify_password("anything", "not a hash at all") is False
    assert auth.verify_password("anything", "") is False


# ------------------------------------------------------------------ sign in
def test_a_wrong_password_and_an_unknown_address_fail_identically(app_db):
    """No account enumeration. These are people's work addresses, and an
    anonymous caller must not be able to learn which of them exist."""
    from services.db import session

    with session() as db:
        with pytest.raises(auth.AuthError) as wrong_password:
            auth.sign_in(db, TEST_EMAIL, "not the password")
        with pytest.raises(auth.AuthError) as no_such_account:
            auth.sign_in(db, "nobody@example.com", "not the password")

    assert str(wrong_password.value) == str(no_such_account.value)


def test_an_address_is_matched_whatever_its_case(app_db):
    """Mail domains are case-insensitive, and two rows for one person is a
    split audit trail nobody notices for months."""
    from services.db import session

    with session() as db:
        user, _ = auth.sign_in(db, "  TESTER@Example.COM  ", TEST_PASSWORD)
        assert user.email == TEST_EMAIL


def test_something_that_is_not_an_address_is_refused():
    for bad in ("", "   ", "no-at-sign", "two@@at.com", "spaces in@it.com", "a@b"):
        with pytest.raises(auth.AuthError):
            auth.check_email(bad)


def test_an_ordinary_address_is_accepted():
    # Deliberately permissive: a strict regex is a famous way to reject
    # somebody's real address.
    for good in ("d.bhardwaj@triburg.com", "a+tag@sub.domain.co.in", "o'neill@example.org"):
        assert auth.check_email(good) == good.lower()


def test_an_invited_user_cannot_sign_in(app_db):
    from services.db import session

    with session() as db:
        auth.create_user(
            db, "invitee@example.com", "Invited Person", roles={"sizeset": "inspector"}
        )
    with session() as db, pytest.raises(auth.AuthError):
        auth.sign_in(db, "invitee@example.com", "")


def test_a_disabled_user_cannot_sign_in(app_db):
    from services.db import session

    with session() as db:
        person = auth.create_user(
            db,
            "gone@example.com",
            "Departed",
            password=FLOOR_PASSWORD,
            roles={"sizeset": "reviewer"},
        )
        person.state = UserState.disabled.value
    with session() as db, pytest.raises(auth.AuthError, match="disabled"):
        auth.sign_in(db, "gone@example.com", FLOOR_PASSWORD)


def test_a_user_on_no_stage_is_told_who_to_ask(app_db):
    """The prototype's lockout message, now from the server."""
    from services.db import session

    with session() as db:
        person = auth.create_user(
            db,
            "stranded@example.com",
            "Stranded",
            password=FLOOR_PASSWORD,
            roles={"sizeset": "inspector"},
        )
        auth.set_roles(db, person, {})
    with session() as db, pytest.raises(auth.AuthError, match="not on any stage"):
        auth.sign_in(db, "stranded@example.com", FLOOR_PASSWORD)


# ------------------------------------------------------------------ sessions
def test_only_the_hash_of_a_token_is_stored(app_db):
    """A database dump must not be replayable as a session."""
    from services.db import session
    from services.db.models import LoginSession

    with session() as db:
        _, token = auth.sign_in(db, TEST_EMAIL, TEST_PASSWORD)
    with session() as db:
        rows = db.query(LoginSession).all()
        assert len(rows) == 1
        assert token not in rows[0].token_hash
        assert len(rows[0].token_hash) == 64  # sha256, hex


def test_an_expired_session_does_not_resolve(app_db):
    from services.db import session
    from services.db.models import LoginSession

    with session() as db:
        _, token = auth.sign_in(db, TEST_EMAIL, TEST_PASSWORD)
    with session() as db:
        row = db.query(LoginSession).one()
        row.expires_at = auth.now() - timedelta(seconds=1)
    with session() as db:
        assert auth.resolve(db, token) is None


def test_disabling_somebody_ends_their_session_immediately(app_db):
    """The whole argument for sessions in a table rather than signed tokens:
    it takes effect now, not when the token they hold runs out."""
    from services.db import session

    with session() as db:
        auth.create_user(
            db,
            "shift@example.com",
            "Shift Worker",
            password=FLOOR_PASSWORD,
            roles={"sizeset": "reviewer"},
        )
        _, token = auth.sign_in(db, "shift@example.com", FLOOR_PASSWORD)
    with session() as db:
        assert auth.resolve(db, token) is not None
        db.scalar(
            select(User).where(User.email == "shift@example.com")
        ).state = UserState.disabled.value
    with session() as db:
        assert auth.resolve(db, token) is None


def test_an_unknown_token_resolves_to_nobody(app_db):
    from services.db import session

    with session() as db:
        assert auth.resolve(db, "made up") is None
        assert auth.resolve(db, "") is None


# -------------------------------------------------------------- the matrix
def test_an_approver_cannot_edit_the_sheet_they_sign_off():
    """The load-bearing rule. If one account could alter a measurement and
    release the document, a wrong reading and its approval would leave no
    trace of disagreement anywhere."""
    assert "release" in auth.ROLES[Role.approver.value]
    assert "audit.edit" not in auth.ROLES[Role.approver.value]
    # And the other way round: whoever corrects it cannot sign it off.
    assert "audit.edit" in auth.ROLES[Role.reviewer.value]
    assert "release" not in auth.ROLES[Role.reviewer.value]


def test_the_capability_names_are_the_prototypes(tmp_path):
    """Ported verbatim, and checked against the prototype rather than trusted.

    demo/auth.js is the design document for this. If somebody renames a
    capability on one side, this fails instead of the two drifting quietly.
    """
    import re
    from pathlib import Path

    demo = Path(__file__).resolve().parents[1] / "demo" / "auth.js"
    if not demo.is_file():  # pragma: no cover - the prototype may be removed
        pytest.skip("demo/auth.js is not present")
    block = demo.read_text(encoding="utf-8").split("const CAPABILITIES = [", 1)[1]
    block = block.split("];", 1)[0]
    in_demo = set(re.findall(r'\["([a-z.]+)"', block))

    assert in_demo == auth.ALL_CAPABILITIES


def test_a_role_is_a_role_in_one_stage(app_db):
    from services.db import session

    with session() as db:
        person = auth.create_user(
            db,
            "split@example.com",
            "Split Role",
            password=FLOOR_PASSWORD,
            roles={"sizeset": "reviewer", "final": "inspector"},
        )
        assert auth.role_on(person, "sizeset") == "reviewer"
        assert auth.role_on(person, "final") == "inspector"
        assert auth.role_on(person, "ppm") is None
        assert auth.can(person, "audit.edit", "sizeset") is True
        assert auth.can(person, "audit.edit", "final") is False
        assert auth.can(person, "audit.edit", "ppm") is False


def test_an_administrator_holds_every_stage_including_new_ones(app_db):
    """A flag, not four rows — see Role. Four rows go stale the first time a
    fifth stage exists."""
    from services.db import session

    with session() as db:
        boss = db.scalar(select(User).where(User.email == TEST_EMAIL))
        assert boss.memberships == []
        assert auth.stages_of(boss) == [stage.value for stage in Stage]
        for stage in Stage:
            assert auth.can(boss, "manage.people", stage.value) is True


# ------------------------------------------------------- the endpoints
OPEN_PATHS = {
    "/",  # the app shell, which draws the sign-in screen
    "/api/session",  # signing in is how you stop being anonymous
    "/api/docs",
    "/api/openapi.json",
    "/openapi.json",
}


def test_every_api_endpoint_refuses_an_anonymous_caller(anonymous):
    """Enumerated from the app's own routing table rather than listed by hand.

    A list written by hand is a list that does not grow when somebody adds an
    endpoint in a hurry, and the endpoint they add in a hurry is the one that
    ships unprotected.
    """
    from api import app as api

    checked = 0
    unprotected = []
    for route in api.app.routes:
        path = getattr(route, "path", "")
        methods = getattr(route, "methods", set()) - {"HEAD", "OPTIONS"}
        if not path.startswith("/api") or path in OPEN_PATHS or not methods:
            continue
        for method in sorted(methods):
            if path == "/api/session" :
                continue
            url = path.format(
                    job_id="whatever", kind="report", user_id="somebody", style_no="7270"
                )
            response = anonymous.request(method, url, json={})
            checked += 1
            if response.status_code != 401:
                unprotected.append(f"{method} {path} -> {response.status_code}")

    assert checked > 10, "the route sweep found almost nothing; has routing changed?"
    assert unprotected == []


def test_signing_in_and_out_through_the_api(anonymous):
    assert anonymous.get("/api/me").status_code == 401

    opened = anonymous.post(
        "/api/session", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert opened.status_code == 200
    assert opened.json()["admin"] is True
    assert set(opened.json()["can"]) == auth.ALL_CAPABILITIES
    assert anonymous.get("/api/me").json()["email"] == TEST_EMAIL
    # The id is a uuid the browser can round-trip, not the address.
    uuid.UUID(anonymous.get("/api/me").json()["id"])

    assert anonymous.delete("/api/session").status_code == 200
    assert anonymous.get("/api/me").status_code == 401


def test_the_session_cookie_is_not_readable_by_script(anonymous):
    opened = anonymous.post(
        "/api/session", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )

    cookie = opened.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "samesite=lax" in cookie


def test_a_bad_password_says_nothing_about_the_account(anonymous):
    wrong = anonymous.post("/api/session", json={"email": TEST_EMAIL, "password": "nope"})
    unknown = anonymous.post(
        "/api/session", json={"email": "ghost@example.com", "password": "nope"}
    )

    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"]


# ------------------------------------------------------ roles on real routes
def test_an_inspector_may_record_but_not_correct(sign_in_as, template, style_sets):
    inspector = sign_in_as(Role.inspector.value)

    assert inspector.get("/api/jobs").status_code == 200
    assert inspector.post("/api/realtime-token").status_code != 403
    settle = inspector.post("/api/jobs/whatever/sheet", json={"edits": []})
    assert settle.status_code == 403
    assert "QA reviewer" in settle.json()["detail"]


def test_a_reviewer_may_correct(sign_in_as):
    reviewer = sign_in_as(Role.reviewer.value)

    # 404 because the job does not exist — which means the gate let it through.
    assert reviewer.post("/api/jobs/whatever/sheet", json={"edits": []}).status_code == 404


def test_an_approver_is_refused_at_the_endpoint_not_just_in_the_table(sign_in_as):
    """The separation of duties, enforced where it counts."""
    approver = sign_in_as(Role.approver.value)

    refused = approver.post("/api/jobs/whatever/sheet", json={"edits": []})
    assert refused.status_code == 403
    refused_resize = approver.post("/api/jobs/whatever/size", json={"from": "M", "to": "L"})
    assert refused_resize.status_code == 403
    # And recording is somebody else's job too.
    assert approver.post("/api/realtime-token").status_code == 403


def test_the_vendor_documents_and_the_working_files_are_different_permissions(
    client, sign_in_as, template, style_sets, stub_pipeline
):
    """A reviewer settles the sheet; an approver releases the PDF. Neither
    does both."""
    from .test_api import _finish

    job = _finish(client)
    reviewer = sign_in_as(Role.reviewer.value)
    approver = sign_in_as(Role.approver.value)

    assert reviewer.get(f"/api/jobs/{job['id']}/download/data").status_code in (200, 307)
    assert reviewer.get(f"/api/jobs/{job['id']}/download/report").status_code == 403

    assert approver.get(f"/api/jobs/{job['id']}/download/report").status_code in (200, 307)
    assert approver.get(f"/api/jobs/{job['id']}/download/graded").status_code in (200, 307)


def test_an_inspector_cannot_reach_the_roster(sign_in_as):
    inspector = sign_in_as(Role.inspector.value)

    assert inspector.get("/api/users").status_code == 403
    assert (
        inspector.post("/api/users", json={"email": "x@y.com", "name": "X"}).status_code == 403
    )


# ----------------------------------------------------------------- roster
def test_an_administrator_adds_and_re_roles_somebody(client):
    created = client.post(
        "/api/users",
        json={
            "email": "N.Newcomer@Example.COM",
            "name": "N. Newcomer",
            "roles": {"sizeset": "inspector"},
            "password": "a fine password",
        },
    )

    assert created.status_code == 201
    # Normalised, not taken as typed.
    assert created.json()["email"] == "n.newcomer@example.com"
    assert created.json()["roles"] == {"sizeset": "inspector"}
    uuid.UUID(created.json()["id"])

    new_id = created.json()["id"]
    changed = client.patch(f"/api/users/{new_id}", json={"roles": {"sizeset": "approver"}})
    assert changed.json()["roles"] == {"sizeset": "approver"}


def test_an_address_can_be_corrected_without_moving_the_person(client):
    """The whole reason the key is a uuid: somebody marries, the audit trail
    still points at the same row."""
    created = client.post(
        "/api/users",
        json={
            "email": "typo@example.com",
            "name": "Mistyped",
            "roles": {"sizeset": "inspector"},
            "password": "a fine password",
        },
    ).json()

    fixed = client.patch(f"/api/users/{created['id']}", json={"email": "right@example.com"})

    assert fixed.status_code == 200
    assert fixed.json()["email"] == "right@example.com"
    assert fixed.json()["id"] == created["id"]


def test_an_address_somebody_else_holds_is_refused(client):
    client.post(
        "/api/users",
        json={
            "email": "taken@example.com",
            "name": "First",
            "roles": {"sizeset": "inspector"},
            "password": "a fine password",
        },
    )
    second = client.post(
        "/api/users",
        json={
            "email": "second@example.com",
            "name": "Second",
            "roles": {"sizeset": "inspector"},
            "password": "a fine password",
        },
    ).json()

    clash = client.patch(f"/api/users/{second['id']}", json={"email": "taken@example.com"})

    assert clash.status_code == 400
    assert "already has an account" in clash.json()["detail"]


def test_roles_are_replaced_not_merged(client):
    made = client.post(
        "/api/users",
        json={
            "email": "two.stage@example.com",
            "name": "Two Stage",
            "roles": {"sizeset": "reviewer", "final": "approver"},
            "password": "a fine password",
        },
    ).json()

    changed = client.patch(f"/api/users/{made['id']}", json={"roles": {"final": "approver"}})

    # The size-set role is gone, not kept alongside. A patch that only adds is
    # how somebody keeps access they were supposed to lose.
    assert changed.json()["roles"] == {"final": "approver"}


def test_the_last_administrator_cannot_be_demoted_or_removed(client):
    me = client.get("/api/me").json()["id"]

    demoted = client.patch(f"/api/users/{me}", json={"admin": False})
    assert demoted.status_code == 409
    assert "last administrator" in demoted.json()["detail"]

    removed = client.delete(f"/api/users/{me}")
    assert removed.status_code == 409


def test_an_id_that_is_not_a_uuid_is_not_found_rather_than_a_crash(client):
    """The id arrives from a URL, so it is whatever somebody typed."""
    assert client.get("/api/users").status_code == 200
    assert client.patch("/api/users/not-a-uuid", json={"name": "X"}).status_code == 404
    assert client.delete("/api/users/not-a-uuid").status_code == 404


def test_you_cannot_remove_the_account_you_are_signed_in_with(client):
    client.post(
        "/api/users",
        json={
            "email": "second.admin@example.com",
            "name": "Second Admin",
            "admin": True,
            "password": "a fine password",
        },
    )
    me = client.get("/api/me").json()["id"]

    # No longer the last administrator, so the refusal below is the other rule.
    refused = client.delete(f"/api/users/{me}")

    assert refused.status_code == 409
    assert "signed in with" in refused.json()["detail"]


def test_a_user_needs_a_stage_or_the_admin_flag(client):
    refused = client.post(
        "/api/users", json={"email": "nowhere@example.com", "name": "Nowhere Person"}
    )

    assert refused.status_code == 400
    assert "at least one stage" in refused.json()["detail"]


def test_an_address_that_is_not_an_address_is_refused(client):
    for bad in ("", "  ", "no-at-sign", "a@b", "two@@at.com", "spaces in@it.com"):
        refused = client.post(
            "/api/users",
            json={"email": bad, "name": "Nope", "roles": {"sizeset": "inspector"}},
        )
        assert refused.status_code == 400, bad


def test_a_made_up_role_is_refused(client):
    refused = client.post(
        "/api/users",
        json={"email": "sneaky@example.com", "name": "Sneaky", "roles": {"sizeset": "superuser"}},
    )

    assert refused.status_code == 400
    assert "not a role" in refused.json()["detail"]


def test_a_role_on_a_stage_that_does_not_exist_is_refused(client):
    refused = client.post(
        "/api/users",
        json={"email": "sneaky@example.com", "name": "Sneaky", "roles": {"warehouse": "reviewer"}},
    )

    assert refused.status_code == 400


def test_changing_somebodys_role_signs_them_out(sign_in_as, client):
    """A narrowed permission takes effect now. Otherwise the person you just
    took off the sheet keeps editing it until their session runs out."""
    reviewer = sign_in_as(Role.reviewer.value)
    assert reviewer.get("/api/me").status_code == 200

    client.patch(f"/api/users/{reviewer.user_id}", json={"roles": {"sizeset": "inspector"}})

    assert reviewer.get("/api/me").status_code == 401


def test_changing_your_password_ends_every_session(client):
    changed = client.post(
        "/api/me/password",
        json={"current": TEST_PASSWORD, "password": "a brand new password"},
    )

    assert changed.status_code == 200
    assert changed.json()["sessions_ended"] >= 1
    assert client.get("/api/me").status_code == 401


def test_the_current_password_is_required_to_change_it(client):
    refused = client.post(
        "/api/me/password", json={"current": "wrong", "password": "a brand new password"}
    )

    assert refused.status_code == 403
    assert client.get("/api/me").status_code == 200  # still signed in


def test_an_unknown_address_costs_the_same_work_as_a_known_one(app_db, monkeypatch):
    """The enumeration oracle told by the clock rather than the message.

    Counting scrypt calls rather than timing them: a wall-clock assertion on a
    shared CI box is a test that fails on a Tuesday for no reason.
    """
    import hashlib

    from services.db import session

    # Warm the dummy hash, which is built once per process.
    with session() as db, pytest.raises(auth.AuthError):
        auth.sign_in(db, "nobody@example.com", "wrong password")

    calls = []
    real = hashlib.scrypt
    monkeypatch.setattr(
        hashlib, "scrypt", lambda *a, **k: (calls.append(1), real(*a, **k))[1]
    )

    with session() as db:
        with pytest.raises(auth.AuthError):
            auth.sign_in(db, TEST_EMAIL, "wrong password")
        known = len(calls)
        calls.clear()
        with pytest.raises(auth.AuthError):
            auth.sign_in(db, "nobody@example.com", "wrong password")
        unknown = len(calls)

    assert known == unknown == 1


def test_uploading_a_style_set_needs_manage_styles(sign_in_as):
    """An inspector can read the library and must not be able to change it: the
    spec sheet is what every measurement is graded against."""
    inspector = sign_in_as("inspector")

    assert inspector.get("/api/style-sets").status_code == 200
    refused = inspector.post(
        "/api/style-sets",
        files={"sheet": ("graded.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert refused.status_code == 403


def test_removing_a_style_set_needs_manage_styles(sign_in_as):
    inspector = sign_in_as("inspector")

    assert inspector.delete("/api/style-sets/sheets/7270").status_code == 403
