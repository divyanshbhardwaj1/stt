"""The alert rules, and the sweep that keeps them honest.

Every threshold in `services/alerts.py` is checked here by handing it a job and
a clock. That is the only honest way to test one — a rule that fires "after a
day" cannot be verified by waiting.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from api.jobs import DONE, FAILED, Job
from services import alerts


def at(hours_ago: float = 0) -> float:
    """An epoch timestamp that many hours in the past."""
    return (datetime.now(UTC) - timedelta(hours=hours_ago)).timestamp()


def job(**over) -> Job:
    """A finished, graded inspection with nothing wrong with it."""
    one = Job(id=over.pop("id", "abc123"), filename="rec_2463(21).mp3", style_no="2463")
    one.name = "rec_2463(21)"
    one.status = DONE
    one.rows = 87
    one.graded = True
    one.graded_style_no = "2463"
    one.judged = 87
    one.unconfirmed = 0
    one.out_of_tolerance = 0
    one.started_at = at(1)
    for key, value in over.items():
        setattr(one, key, value)
    return one


def keys(found) -> set[str]:
    return {one.rule for one in found}


# ----------------------------------------------------------------- thresholds
def test_a_reading_with_no_verdict_is_not_an_alert_on_the_same_day():
    """A reviewer gets the working day before anybody is told about it."""
    fresh = job(unconfirmed=1, started_at=at(hours_ago=23))

    assert keys(alerts.evaluate([fresh])) == set()


def test_after_a_day_it_is():
    stale = job(unconfirmed=1, started_at=at(hours_ago=25))

    found = alerts.evaluate([stale])

    assert keys(found) == {"unanswered_stale"}
    assert found[0].severity == alerts.ACT
    # Every alert goes to the administrators. One answer, always true.
    assert found[0].needs == alerts.ADMINS
    assert "no verdict" in found[0].title
    assert "not passes" in found[0].detail


def test_the_boundary_is_the_stated_one():
    """24 hours, because that is what the floor asked for. Pinned so a change
    to it is a decision somebody makes rather than a number that drifts."""
    assert alerts.UNANSWERED_HOURS == 24

    just_under = job(unconfirmed=2, started_at=at(hours_ago=alerts.UNANSWERED_HOURS - 0.1))
    just_over = job(unconfirmed=2, started_at=at(hours_ago=alerts.UNANSWERED_HOURS + 0.1))

    assert keys(alerts.evaluate([just_under])) == set()
    assert keys(alerts.evaluate([just_over])) == {"unanswered_stale"}


def test_sign_off_waits_longer_than_a_reading():
    """The work is finished; only the signature is missing."""
    day_old = job(started_at=at(hours_ago=25))
    week_old = job(started_at=at(hours_ago=24 * 5))

    assert keys(alerts.evaluate([day_old])) == set()

    found = alerts.evaluate([week_old])
    assert keys(found) == {"awaiting_signoff"}
    assert found[0].needs == alerts.ADMINS


# ---------------------------------------------------------------- what counts
def test_a_failed_job_is_immediate():
    broken = job(status=FAILED, error="no measurements found", started_at=at(0.01))

    found = alerts.evaluate([broken])

    assert keys(found) == {"processing_failed"}
    assert found[0].detail == "no measurements found"


def test_a_recording_that_produced_nothing_is_raised():
    """The expensive one. The garment is back in the bin by the time anybody
    reads a report that was never going to have rows in it."""
    silent = job(rows=0, graded=False, judged=0)

    found = alerts.evaluate([silent])

    assert keys(found) == {"no_measurements"}
    # Worth waking somebody for, so it ships on both ways out.
    assert alerts.BY_KEY["no_measurements"].ways == (alerts.INAPP, alerts.EMAIL)


def test_an_inspection_checked_against_nothing_is_raised():
    ungraded = job(graded=False, graded_style_no="", announced_style_no="7122")

    found = alerts.evaluate([ungraded])

    assert keys(found) == {"not_graded"}
    assert "7122" in found[0].detail


def test_a_measurement_out_of_tolerance_is_not_an_alert():
    """FAIL CONDITIONALLY is a verdict, not a fault.

    It is the outcome of an inspection that went correctly, and it happens on a
    large share of normal work. A list that fires on normal work is a list
    nobody reads.
    """
    failing = job(out_of_tolerance=2, started_at=at(hours_ago=24 * 9))

    assert keys(alerts.evaluate([failing])) == set()


def test_a_job_still_running_is_left_alone_until_it_is_late():
    running = job(status="running", message="transcribing", started_at=at(0.1))
    hung = job(status="running", message="transcribing", started_at=at(2))

    assert keys(alerts.evaluate([running])) == set()
    assert keys(alerts.evaluate([hung])) == {"stuck"}


def test_one_job_raises_one_thing():
    """Ranked, not accumulated. An inspection that produced nothing is also
    ungraded and also has no verdicts, and saying so three times is three
    entries for one problem."""
    empty = job(rows=0, graded=False, unconfirmed=0, judged=0)

    assert len(alerts.evaluate([empty])) == 1


# --------------------------------------------------------------------- sweep
def test_the_sweep_raises_once_however_often_it_runs(app_db):
    """The whole reason the key exists. A sweep every five minutes would
    otherwise raise two hundred and eighty-eight copies of one stuck
    inspection a day."""
    stale = job(unconfirmed=1, started_at=at(hours_ago=30))

    assert alerts.sweep([stale]) == (1, 0)
    assert alerts.sweep([stale]) == (0, 0)
    assert alerts.sweep([stale]) == (0, 0)

    assert len(_live()) == 1


def test_an_alert_closes_itself_when_the_condition_goes(app_db):
    """Without this the list fills with things already dealt with, people stop
    trusting it, and it becomes a worse copy of the dashboard."""
    stale = job(unconfirmed=1, started_at=at(hours_ago=30))
    alerts.sweep([stale])

    settled = job(unconfirmed=0, started_at=at(hours_ago=30))
    assert alerts.sweep([settled]) == (0, 1)
    assert _live() == []


def test_a_condition_that_comes_back_gets_a_new_row(app_db):
    """History, not one row that keeps changing its mind."""
    from services.db import session
    from services.db.models import Alert

    stale = job(unconfirmed=1, started_at=at(hours_ago=30))
    alerts.sweep([stale])
    alerts.sweep([job(unconfirmed=0, started_at=at(hours_ago=30))])
    alerts.sweep([stale])

    with session() as db:
        rows = db.query(Alert).filter(Alert.key == "unanswered_stale:abc123").all()
        assert len(rows) == 2
        assert sorted(row.resolution for row in rows) == ["", "gone"]


def test_two_inspections_raise_two_alerts(app_db):
    alerts.sweep(
        [
            job(id="one", unconfirmed=1, started_at=at(hours_ago=30)),
            job(id="two", unconfirmed=3, started_at=at(hours_ago=40)),
        ]
    )

    assert {row.subject_id for row in _live()} == {"one", "two"}


def _live():
    from services.db import session
    from services.db.models import Alert

    with session() as db:
        rows = db.query(Alert).filter(Alert.resolved_at.is_(None)).all()
        return [
            type("Row", (), {"key": row.key, "subject_id": row.subject_id})()
            for row in rows
        ]


# ----------------------------------------------------------------- endpoints
def test_the_list_is_for_administrators(sign_in_as, monkeypatch):
    """Every alert goes to the administrators, so everybody else's list is
    empty rather than partial. One audience is one answer."""
    from api import app as api

    admin = sign_in_as(admin=True)
    reviewer = sign_in_as("reviewer")
    stale = job(unconfirmed=1, started_at=at(hours_ago=30))
    monkeypatch.setattr(api.store, "all", lambda: [stale])

    assert [one["rule"] for one in admin.get("/api/alerts").json()] == ["unanswered_stale"]
    assert reviewer.get("/api/alerts").json() == []


def test_an_alert_can_be_dismissed(sign_in_as, monkeypatch):
    from api import app as api

    admin = sign_in_as(admin=True)
    stale = job(unconfirmed=1, started_at=at(hours_ago=30))
    monkeypatch.setattr(api.store, "all", lambda: [stale])

    one = admin.get("/api/alerts").json()[0]

    assert admin.post(f"/api/alerts/{one['id']}/dismiss").status_code == 200
    assert admin.get("/api/alerts").json() == []
    # And it is a decision, so it is on the record.
    assert any(
        "Dismissed an alert" in event["what"] for event in admin.get("/api/activity").json()
    )


def test_somebody_who_is_not_an_administrator_cannot_dismiss(sign_in_as, monkeypatch):
    from api import app as api

    admin = sign_in_as(admin=True)
    reviewer = sign_in_as("reviewer")
    stale = job(unconfirmed=1, started_at=at(hours_ago=30))
    monkeypatch.setattr(api.store, "all", lambda: [stale])

    one = admin.get("/api/alerts").json()[0]

    assert reviewer.post(f"/api/alerts/{one['id']}/dismiss").status_code == 403


@pytest.mark.parametrize("bad", ["not-a-uuid", "7c9e6679-7425-40de-944b-e07fc1f90ae7"])
def test_dismissing_something_that_is_not_there(sign_in_as, bad):
    reviewer = sign_in_as(admin=True)

    assert reviewer.post(f"/api/alerts/{bad}/dismiss").status_code == 404


def test_a_dismissal_holds_while_the_condition_lasts(sign_in_as, monkeypatch):
    """Otherwise dismissing does nothing: the next sweep raises it again."""
    from api import app as api

    reviewer = sign_in_as(admin=True)
    stale = job(unconfirmed=1, started_at=at(hours_ago=30))
    monkeypatch.setattr(api.store, "all", lambda: [stale])

    one = reviewer.get("/api/alerts").json()[0]
    reviewer.post(f"/api/alerts/{one['id']}/dismiss")

    # Three more sweeps, condition unchanged.
    assert reviewer.get("/api/alerts").json() == []
    assert reviewer.get("/api/alerts").json() == []
    assert reviewer.get("/api/alerts").json() == []


def test_the_same_thing_going_wrong_again_is_news(sign_in_as, monkeypatch):
    """A dismissal covers one occurrence, not the rule."""
    from api import app as api

    reviewer = sign_in_as(admin=True)
    settled = job(unconfirmed=0, started_at=at(hours_ago=30))
    stale = job(unconfirmed=1, started_at=at(hours_ago=30))
    showing = [stale]
    monkeypatch.setattr(api.store, "all", lambda: list(showing))

    reviewer.post(f"/api/alerts/{reviewer.get('/api/alerts').json()[0]['id']}/dismiss")
    assert reviewer.get("/api/alerts").json() == []

    # The reviewer settles it, so the condition clears...
    showing[:] = [settled]
    assert reviewer.get("/api/alerts").json() == []

    # ...and a later recording on the same inspection leaves a gap again.
    showing[:] = [stale]
    assert [one["rule"] for one in reviewer.get("/api/alerts").json()] == ["unanswered_stale"]


# ---------------------------------------------------------------- the policy
def test_a_rule_can_be_turned_off(app_db):
    stale = job(unconfirmed=1, started_at=at(hours_ago=30))
    assert keys(alerts.evaluate([stale], rules=alerts.policy())) == {"unanswered_stale"}

    alerts.configure("unanswered_stale", enabled=False)

    assert keys(alerts.evaluate([stale], rules=alerts.policy())) == set()


def test_a_threshold_can_be_moved(app_db):
    """Four hours on a floor that turns work around in a shift."""
    six_hours = job(unconfirmed=1, started_at=at(hours_ago=6))
    assert keys(alerts.evaluate([six_hours], rules=alerts.policy())) == set()

    alerts.configure("unanswered_stale", amount=4)

    assert keys(alerts.evaluate([six_hours], rules=alerts.policy())) == {"unanswered_stale"}


def test_a_threshold_is_typed_in_the_unit_the_rule_uses(app_db):
    """Minutes for a hung job, days for a signature. A page that makes somebody
    convert to hours is a page that gets it wrong."""
    alerts.configure("stuck", amount=90)  # minutes
    alerts.configure("awaiting_signoff", amount=7)  # days

    settled = alerts.policy()
    assert settled["stuck"]["hours"] == pytest.approx(1.5)
    assert settled["awaiting_signoff"]["hours"] == pytest.approx(168)
    # and comes back out in the same unit it went in
    assert alerts.in_unit(alerts.BY_KEY["stuck"], settled["stuck"]["hours"]) == 90
    signoff = alerts.BY_KEY["awaiting_signoff"]
    assert alerts.in_unit(signoff, settled["awaiting_signoff"]["hours"]) == 7


def test_setting_something_back_to_the_default_stores_nothing(app_db):
    """Otherwise this floor is frozen at today's numbers, and a threshold
    changed in a later release silently never reaches them."""
    from services.db import session
    from services.db.models import AlertSetting

    alerts.configure("unanswered_stale", amount=4)
    with session() as db:
        assert db.query(AlertSetting).count() == 1

    alerts.configure("unanswered_stale", amount=alerts.UNANSWERED_HOURS)

    with session() as db:
        assert db.query(AlertSetting).count() == 0
    assert alerts.policy()["unanswered_stale"]["hours"] == alerts.UNANSWERED_HOURS


def test_how_a_rule_goes_out_can_be_changed(app_db):
    """The one thing about delivery worth arguing over: which of these is
    worth an email, and which can wait until somebody opens the app."""
    assert alerts.policy()["unanswered_stale"]["ways"] == ["inapp", "email"]

    alerts.configure("unanswered_stale", ways=["inapp"])

    assert alerts.policy()["unanswered_stale"]["ways"] == ["inapp"]


def test_a_rule_with_nothing_to_wait_for_refuses_a_threshold(app_db):
    with pytest.raises(alerts.AlertError, match="nothing to wait for"):
        alerts.configure("processing_failed", amount=3)


def test_a_setting_that_would_not_mean_anything_is_refused(app_db):
    with pytest.raises(alerts.AlertError, match="is not a rule"):
        alerts.configure("no_such_rule", enabled=False)
    with pytest.raises(alerts.AlertError, match="not a way of telling"):
        alerts.configure("unanswered_stale", ways=["carrier pigeon"])
    # Both off is not a quieter alert, it is one nobody sees.
    with pytest.raises(alerts.AlertError, match="at least one way"):
        alerts.configure("unanswered_stale", ways=[])
    for silly in (0, -3, 24 * 400):
        with pytest.raises(alerts.AlertError):
            alerts.configure("unanswered_stale", amount=silly)


def test_a_rule_the_product_no_longer_has_is_ignored(app_db):
    """A settings row left behind by a release must not break the page."""
    from services.db import session
    from services.db.models import AlertSetting

    with session() as db:
        db.add(AlertSetting(rule="retired_rule", stage="sizeset", enabled=False))

    assert set(alerts.policy()) == set(alerts.BY_KEY)


# ------------------------------------------------------- the settings screen
def test_the_settings_page_is_the_catalogue_plus_what_was_changed(client):
    client.patch("/api/alert-rules/unanswered_stale", json={"amount": 4})

    body = client.get("/api/alert-rules").json()
    by_key = {one["key"]: one for one in body["rules"]}

    assert set(by_key) == set(alerts.BY_KEY)
    assert by_key["unanswered_stale"]["amount"] == 4
    # The page can say which of these is not the shipped answer.
    assert by_key["unanswered_stale"]["default_amount"] == 24
    assert by_key["unanswered_stale"]["unit"] == "hours"
    assert by_key["stuck"]["unit"] == "minutes"
    # A rule that fires on the spot has no number to show.
    assert by_key["processing_failed"]["amount"] is None
    # Two ways out, and the page is told whether email can go anywhere at all
    # rather than offering a switch that quietly does nothing.
    assert [one["id"] for one in body["channels"]] == ["inapp", "email"]
    assert body["email_ready"] is False
    assert by_key["unanswered_stale"]["ways"] == ["inapp", "email"]
    assert by_key["awaiting_signoff"]["ways"] == ["inapp"]


def test_changing_a_rule_is_written_down(client):
    client.patch("/api/alert-rules/awaiting_signoff", json={"enabled": False})

    trail = client.get("/api/activity").json()
    assert "Waiting for sign-off" in trail[0]["what"]


def test_the_settings_are_for_administrators(sign_in_as):
    reviewer = sign_in_as("reviewer")

    assert reviewer.get("/api/alert-rules").status_code == 403
    assert reviewer.patch("/api/alert-rules/stuck", json={"amount": 5}).status_code == 403
    assert reviewer.post("/api/alert-rules/test").status_code == 403


def test_a_test_alert_can_be_raised_and_dismissed(client):
    assert client.post("/api/alert-rules/test").status_code == 201

    open_now = client.get("/api/alerts").json()
    mine = [one for one in open_now if one["rule"] == "test"]
    assert len(mine) == 1
    assert mine[0]["severity"] == "notice"

    # Pressing it twice does not leave two.
    client.post("/api/alert-rules/test")
    assert len([one for one in client.get("/api/alerts").json() if one["rule"] == "test"]) == 1

    assert client.post(f"/api/alerts/{mine[0]['id']}/dismiss").status_code == 200


# ---------------------------------------------------------------------- mail
def test_a_new_alert_is_emailed_to_the_administrators(app_db, monkeypatch):
    sent = []
    monkeypatch.setattr(alerts.mail, "enabled", lambda: True)
    monkeypatch.setattr(alerts.mail, "send", lambda to, subject, body: sent.append((to, subject)))

    alerts.sweep([job(unconfirmed=1, started_at=at(hours_ago=30))])

    assert len(sent) == 1
    to, subject = sent[0]
    assert to == ["tester@example.com"]  # the one administrator on the roster
    assert "no verdict" in subject


def test_the_same_alert_is_not_emailed_twice(app_db, monkeypatch):
    """A sweep runs whenever somebody opens a screen. Without the dedup key
    this would send the same stuck inspection a hundred times before lunch."""
    sent = []
    monkeypatch.setattr(alerts.mail, "enabled", lambda: True)
    monkeypatch.setattr(alerts.mail, "send", lambda to, subject, body: sent.append(subject))

    stale = job(unconfirmed=1, started_at=at(hours_ago=30))
    alerts.sweep([stale])
    alerts.sweep([stale])
    alerts.sweep([stale])

    assert len(sent) == 1


def test_a_rule_set_to_the_app_only_sends_nothing(app_db, monkeypatch):
    sent = []
    monkeypatch.setattr(alerts.mail, "enabled", lambda: True)
    monkeypatch.setattr(alerts.mail, "send", lambda to, subject, body: sent.append(subject))
    alerts.configure("unanswered_stale", ways=["inapp"])

    raised, _ = alerts.sweep([job(unconfirmed=1, started_at=at(hours_ago=30))])

    assert raised == 1  # still in the list
    assert sent == []  # just not in anybody's inbox


def test_no_mail_server_is_not_a_failure(app_db, monkeypatch):
    """The normal state. The alert is raised either way."""
    monkeypatch.delenv("SMTP_HOST", raising=False)

    assert alerts.mail.enabled() is False
    assert alerts.sweep([job(unconfirmed=1, started_at=at(hours_ago=30))]) == (1, 0)


# ---------------------------------------------------------- one stage at a time
def test_a_threshold_belongs_to_one_stage(app_db):
    """A reading with no verdict on size set is a garment still on the table.
    The same gap on a final inspection is a lot already packed, and one number
    for both is wrong for one of them."""
    alerts.configure("unanswered_stale", amount=4, stage="sizeset")

    assert alerts.policy("sizeset")["unanswered_stale"]["hours"] == 4
    assert alerts.policy("final")["unanswered_stale"]["hours"] == alerts.UNANSWERED_HOURS


def test_turning_a_rule_off_on_one_stage_leaves_the_others(app_db):
    alerts.configure("awaiting_signoff", enabled=False, stage="final")

    assert alerts.policy("final")["awaiting_signoff"]["enabled"] is False
    assert alerts.policy("sizeset")["awaiting_signoff"]["enabled"] is True


def test_the_sweep_judges_each_job_by_its_own_stage(app_db):
    """The one that matters. Two inspections, two stages, two thresholds -
    and the sweep has to use the right one for each."""
    alerts.configure("unanswered_stale", amount=4, stage="final")

    on_sizeset = job(id="ss", unconfirmed=1, started_at=at(hours_ago=6))
    on_final = job(id="fi", unconfirmed=1, started_at=at(hours_ago=6))
    on_final.stage = "final"

    raised, _ = alerts.sweep([on_sizeset, on_final])

    # Six hours: inside size set's day, past final's four hours.
    assert raised == 1
    live = _live()
    assert [one.subject_id for one in live] == ["fi"]


def test_an_alert_carries_the_stage_it_is_about(app_db):
    on_final = job(id="fi", unconfirmed=1, started_at=at(hours_ago=30))
    on_final.stage = "final"

    found = alerts.evaluate([on_final])

    assert found[0].stage == "final"


def test_the_settings_endpoint_is_per_stage(client):
    client.patch(
        "/api/alert-rules/unanswered_stale", json={"stage": "final", "amount": 2}
    )

    final = client.get("/api/alert-rules?stage=final").json()
    sizeset = client.get("/api/alert-rules?stage=sizeset").json()

    assert final["stage"] == "final"
    assert {one["key"]: one["amount"] for one in final["rules"]}["unanswered_stale"] == 2
    assert {one["key"]: one["amount"] for one in sizeset["rules"]}["unanswered_stale"] == 24
    assert client.get("/api/alert-rules?stage=nowhere").status_code == 404
