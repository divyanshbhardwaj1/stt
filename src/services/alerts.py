"""The rules, and the sweep that keeps the alerts table honest.

Every rule is a plain function over the job list. No database, no clock of its
own, no I/O - `evaluate` takes the jobs and the time and returns what should be
live right now. That makes every threshold in here testable by handing it a job
and a timestamp, which matters more than usual: the thresholds are the part
somebody will want to argue about.

Three rules that earn a place, and one that deliberately does not:

    `out_of_tolerance` is not here. A measurement outside the band is a
    verdict, not a fault - FAIL CONDITIONALLY is a legitimate outcome of an
    inspection that went correctly. Alerting on it would fire on a large share
    of normal work, and a list that fires on normal work is a list nobody
    reads. What is worth alerting on is an out-of-tolerance report nobody has
    looked at, and that is `unanswered_stale`'s neighbour, not this.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from . import mail
from .db import session
from .db.models import Alert, AlertSetting, User

log = logging.getLogger(__name__)

# How long a reading may sit without a verdict before it is somebody's problem.
# Not a service level: there is no due date on an inspection. A day is how long
# a recording can sit before the garment it was taken from has moved on, which
# is the thing actually being measured.
UNANSWERED_HOURS = 24

# Reviewed, inside tolerance, and nobody has signed. Longer than the reading
# threshold on purpose - the work is finished, only the signature is missing.
SIGNOFF_DAYS = 3

# Long enough that a real transcription has finished, short enough that a hung
# one is caught within the shift that produced it.
STUCK_MINUTES = 30

ACT = "act"
NOTICE = "notice"

# Every alert goes to the administrators. Not a setting: it is one answer that
# is always true, and the roster already holds their addresses, so there is
# nothing to keep in step when somebody changes job.
ADMINS = "manage.people"

INAPP = "inapp"
EMAIL = "email"
CHANNELS = ((INAPP, "In the app"), (EMAIL, "Email"))


@dataclass(frozen=True)
class Rule:
    """One thing the system can watch, as the product defines it.

    The catalogue lives here and the settings live in the database, joined by
    `key`. A rule added in code appears on the settings page with a sensible
    default already set; a rule removed from code disappears from it, and the
    orphaned settings row is harmless. That way there is no migration per rule,
    and no way for the page and the sweep to disagree about what exists.
    """

    key: str
    label: str
    blurb: str
    severity: str
    # Hours. `None` means the condition is its own alarm and there is nothing
    # to wait for - a job that failed has failed.
    hours: float | None
    # The ways out this rule uses before anybody changes them. In the app for
    # all of them: the list is free and always there. Email only where being
    # told an hour later is too late to matter.
    ways: tuple[str, ...] = (INAPP,)
    # What the number is shown and typed in. Hours are the storage unit for all
    # of them, because a threshold nobody can compare is a threshold nobody can
    # reason about.
    unit: str = "hours"


CATALOGUE: tuple[Rule, ...] = (
    Rule(
        key="processing_failed",
        label="Processing failed",
        blurb="Nothing was written and nothing was sent anywhere.",
        severity=ACT,
        hours=None,
        ways=(INAPP, EMAIL),
    ),
    Rule(
        key="no_measurements",
        label="A recording produced nothing",
        blurb=(
            "The transcript came back with nothing to grade - usually a headset that was "
            "not open. The garment is back in the bin by the time anybody reads the report."
        ),
        severity=ACT,
        hours=None,
        ways=(INAPP, EMAIL),
    ),
    Rule(
        key="not_graded",
        label="Never checked against a spec sheet",
        blurb="No style was chosen and none was announced, so nothing was graded.",
        severity=ACT,
        hours=None,
    ),
    Rule(
        key="unanswered_stale",
        label="Readings with no verdict",
        blurb=(
            "Heard, never ruled on. Not passes - each one has to be listened back to, and "
            "the garment gets harder to find every day."
        ),
        severity=ACT,
        hours=UNANSWERED_HOURS,
        ways=(INAPP, EMAIL),
    ),
    Rule(
        key="awaiting_signoff",
        label="Waiting for sign-off",
        blurb="Every verdict captured, everything inside tolerance, nobody has signed.",
        severity=ACT,
        hours=SIGNOFF_DAYS * 24,
        unit="days",
    ),
    Rule(
        key="stuck",
        label="Still processing",
        blurb="Running far longer than a recording of this length should take.",
        severity=ACT,
        hours=STUCK_MINUTES / 60,
        unit="minutes",
    ),
)

BY_KEY = {rule.key: rule for rule in CATALOGUE}

# What a rule is worth in its own unit, and back again. Stored in hours so two
# thresholds can be compared; shown in the unit somebody would say out loud.
PER_UNIT = {"minutes": 1 / 60, "hours": 1.0, "days": 24.0}


def in_unit(rule: Rule, hours: float | None) -> float | None:
    return None if hours is None else round(hours / PER_UNIT[rule.unit], 4)


def to_hours(rule: Rule, amount: float) -> float:
    return amount * PER_UNIT[rule.unit]


def defaults() -> dict[str, dict]:
    """The catalogue as a policy: what happens before anybody changes anything.

    Every rule ships on. A settings page that has to be filled in before
    anything happens is a settings page nobody fills in, and then the feature
    "does not work".
    """
    return {
        rule.key: {"enabled": True, "hours": rule.hours, "ways": list(rule.ways)}
        for rule in CATALOGUE
    }


def policy(stage: str = "sizeset") -> dict[str, dict]:
    """The catalogue for one stage, with whatever an administrator changed.

    Per stage, because the stages are not the same job. A reading with no
    verdict on size set is a garment still on the table; the same gap on a
    final inspection is a lot already packed. One threshold for both would be
    wrong for one of them.

    Only the differences are stored, so changing a default in code still moves
    every stage that never touched that rule.
    """
    settled = defaults()
    try:
        with session() as db:
            for row in db.scalars(
                select(AlertSetting).where(AlertSetting.stage == stage)
            ).all():
                if row.rule not in settled:
                    continue  # a rule this version of the product no longer has
                if row.enabled is not None:
                    settled[row.rule]["enabled"] = row.enabled
                if row.threshold_hours is not None:
                    settled[row.rule]["hours"] = row.threshold_hours
                if row.channels:
                    settled[row.rule]["ways"] = row.channels.split(",")
    except Exception:  # noqa: BLE001 - no database yet, or it is unreachable
        log.warning("alert settings could not be read; using the defaults")
    return settled


@dataclass(frozen=True)
class Raised:
    """One condition, as the rules see it before it becomes a row."""

    key: str
    rule: str
    severity: str
    needs: str
    subject_id: str
    title: str
    detail: str
    stage: str = "sizeset"


def _plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def _said(key: str, rules: dict[str, dict]) -> str:
    """"24 hours", "3 days" - the threshold as somebody would say it."""
    rule = BY_KEY[key]
    amount = in_unit(rule, rules.get(key, {}).get("hours"))
    if amount is None:
        return "no time at all"
    whole = int(amount) if float(amount).is_integer() else amount
    return f"{whole} {rule.unit[:-1] if whole == 1 else rule.unit}"


def _age(job, now: datetime) -> timedelta:
    return now - datetime.fromtimestamp(job.started_at, tz=UTC)


def evaluate(
    jobs, now: datetime | None = None, rules: dict[str, dict] | None = None
) -> list[Raised]:
    """Everything that should be live, given these jobs at this moment.

    Pure. No database and no clock of its own: the policy is handed in, which
    is what lets a test check a threshold by passing a job and a timestamp
    rather than by waiting a day.
    """
    now = now or datetime.now(UTC)
    rules = rules if rules is not None else defaults()
    out: list[Raised] = []

    def live(key: str) -> bool:
        return rules.get(key, {}).get("enabled", False)

    def after(key: str) -> timedelta:
        hours = rules.get(key, {}).get("hours")
        return timedelta(hours=hours or 0)


    for job in jobs:
        where = job.title or job.name or job.filename or job.id
        # The stage the work is at, so the list can be split by it.
        at = getattr(job, "stage", "") or "sizeset"
        style = job.graded_style_no or job.announced_style_no or job.style_no

        # ------------------------------------------------- the machine stopped
        if job.status == "failed" and live("processing_failed"):
            out.append(
                Raised(
                    key=f"processing_failed:{job.id}",
                    rule="processing_failed",
                    severity=ACT,
                    needs=ADMINS,
                    subject_id=job.id,
                    stage=at,
                    title=f"{where} never finished processing",
                    detail=job.error
                    or "Nothing was written, and nothing was sent anywhere.",
                )
            )
            continue

        if job.status != "done":
            if live("stuck") and _age(job, now) > after("stuck"):
                out.append(
                    Raised(
                        key=f"stuck:{job.id}",
                        rule="stuck",
                        severity=ACT,
                        needs=ADMINS,
                        subject_id=job.id,
                        stage=at,
                        title=f"{where} has been processing for longer than expected",
                        detail=job.message
                        or "Far longer than a recording of this length should take.",
                    )
                )
            continue

        # ---------------------------------------------- the recording was empty
        if not job.rows and live("no_measurements"):
            out.append(
                Raised(
                    key=f"no_measurements:{job.id}",
                    rule="no_measurements",
                    severity=ACT,
                    needs=ADMINS,
                    subject_id=job.id,
                    stage=at,
                    title=f"{where} produced no measurements",
                    detail=(
                        "The transcript came back with nothing to grade - usually a headset "
                        "that was not open. Worth checking before the garment goes back."
                    ),
                )
            )
            continue

        # ------------------------------------------- nothing to check it against
        if not job.graded and live("not_graded"):
            out.append(
                Raised(
                    key=f"not_graded:{job.id}",
                    rule="not_graded",
                    severity=ACT,
                    needs=ADMINS,
                    subject_id=job.id,
                    stage=at,
                    title=f"{where} was never checked against a spec sheet",
                    detail=(
                        f"The recording announced style {style}, and no sheet was used."
                        if style
                        else "No style was chosen and none was announced."
                    ),
                )
            )
            continue

        # -------------------------------------------------- waiting on a person
        if job.unconfirmed:
            if live("unanswered_stale") and _age(job, now) > after("unanswered_stale"):
                out.append(
                    Raised(
                        key=f"unanswered_stale:{job.id}",
                        rule="unanswered_stale",
                        severity=ACT,
                        needs=ADMINS,
                        subject_id=job.id,
                        stage=at,
                        title=(
                            f"{where}: {_plural(job.unconfirmed, 'point')} of measure "
                            f"still {'has' if job.unconfirmed == 1 else 'have'} no verdict"
                        ),
                        detail=(
                            f"Recorded more than {_said('unanswered_stale', rules)} ago "
                            f"on style {style}. "
                            "These are not passes - each one has to be listened back to and "
                            "filled in, and the garment gets harder to find every day."
                        ),
                    )
                )
            continue

        if (
            not job.out_of_tolerance
            and not job.released_at
            and live("awaiting_signoff")
            and _age(job, now) > after("awaiting_signoff")
        ):
            out.append(
                Raised(
                    key=f"awaiting_signoff:{job.id}",
                    rule="awaiting_signoff",
                    severity=ACT,
                    needs=ADMINS,
                    subject_id=job.id,
                    stage=at,
                    title=f"{where} has been waiting for sign-off",
                    detail=(
                        f"Every point of measure on style {style} was heard and ruled on, and "
                        "everything sits inside tolerance. Only the signature is missing."
                    ),
                )
            )

    return out


def sweep(jobs, now: datetime | None = None) -> tuple[int, int]:
    """Bring the table into line with what the rules say right now.

    Returns (raised, resolved). Idempotent by construction: a condition already
    live is left alone rather than raised again, and a live row whose condition
    has gone closes itself.

    That second half is the one that keeps the feature alive. Without it the
    list fills with things already dealt with, people stop trusting it, and it
    becomes a worse copy of the dashboard.
    """
    now = now or datetime.now(UTC)
    # One pass per stage, each with that stage's own settings. Grouped here
    # rather than inside `evaluate`, which stays a pure function of one policy
    # so a test can check a threshold by handing it a job and a clock.
    by_stage: dict[str, list] = {}
    for job in jobs:
        by_stage.setdefault(getattr(job, "stage", "sizeset") or "sizeset", []).append(job)

    wanted: dict[str, Raised] = {}
    ways_for: dict[str, list[str]] = {}
    for stage, theirs in by_stage.items():
        rules_now = policy(stage)
        for found in evaluate(theirs, now, rules_now):
            wanted[found.key] = found
            ways_for[found.key] = rules_now.get(found.rule, {}).get("ways") or []

    raised = resolved = 0
    posted: list[Raised] = []
    with session() as db:
        # Only the rows the rules are responsible for. An alert raised some
        # other way - the test button, and anything a later release raises on
        # an event rather than a condition - has no rule to disagree with, and
        # closing it because no rule asked for it would make it impossible to
        # raise one at all.
        live = db.scalars(
            select(Alert).where(Alert.resolved_at.is_(None), Alert.rule.in_(BY_KEY))
        ).all()
        for alert in live:
            if alert.key not in wanted:
                alert.resolved_at = now
                alert.resolution = "gone"
                resolved += 1
        standing = {alert.key for alert in live if alert.resolved_at is None}

        # A dismissal holds until the condition clears by itself. Without this
        # the next sweep raises the same row a minute later and dismissing
        # means nothing.
        muted = db.scalars(
            select(Alert).where(
                Alert.resolution == "dismissed",
                Alert.cleared_at.is_(None),
                Alert.rule.in_(BY_KEY),
            )
        ).all()
        silenced = set()
        for alert in muted:
            if alert.key in wanted:
                silenced.add(alert.key)
            else:
                # It has gone on its own. The dismissal has done its work, and
                # the same thing happening again next week is news.
                alert.cleared_at = now

        for key, found in wanted.items():
            if key in standing or key in silenced:
                continue
            db.add(
                Alert(
                    key=key,
                    rule=found.rule,
                    stage=found.stage,
                    severity=found.severity,
                    needs=found.needs,
                    subject_id=found.subject_id,
                    title=found.title,
                    detail=found.detail,
                    raised_at=now,
                )
            )
            raised += 1
            if EMAIL in ways_for.get(key, ()):
                posted.append(found)
    _email(posted)
    if raised or resolved:
        log.info("alerts: %d raised, %d resolved", raised, resolved)
    return raised, resolved


class AlertError(ValueError):
    """A setting that would not mean anything."""


# A threshold longer than this is not a threshold, it is off. Said as a number
# rather than left open so that a typo cannot silently retire a rule.
MAX_HOURS = 24 * 90


def configure(
    rule_key: str,
    *,
    enabled: bool | None = None,
    amount: float | None = None,
    ways: list[str] | None = None,
    stage: str = "sizeset",
) -> dict:
    """Change one rule for one stage, and return how it now stands.

    `amount` arrives in the rule's own unit - minutes for a hung job, days for
    a signature - and is stored in hours, because two thresholds that cannot be
    compared are two thresholds nobody can reason about.

    A setting that matches the default is not stored. That is what keeps a
    floor on the defaults actually on them: a threshold changed in code still
    reaches everybody who never touched that rule.
    """
    rule = BY_KEY.get(rule_key)
    if rule is None:
        raise AlertError(f"{rule_key!r} is not a rule.")
    if ways is not None:
        chosen = [way for way in ways if way in dict(CHANNELS)]
        if len(chosen) != len(ways):
            raise AlertError("That is not a way of telling anybody.")
        if not chosen:
            # Both off is not a quieter alert, it is an alert nobody sees. If
            # that is what somebody wants, the switch for it is Off.
            raise AlertError(
                "Pick at least one way, or turn the rule off - a rule with no "
                "way out is raised and never read."
            )
        ways = chosen
    hours = None
    if amount is not None:
        if rule.hours is None:
            raise AlertError(f"{rule.label} has nothing to wait for - it fires when it happens.")
        hours = to_hours(rule, float(amount))
        if hours <= 0 or hours > MAX_HOURS:
            raise AlertError(
                f"A {rule.unit[:-1]} count has to be above zero and under {MAX_HOURS // 24} days."
            )

    with session() as db:
        row = db.scalar(
            select(AlertSetting).where(
                AlertSetting.rule == rule_key, AlertSetting.stage == stage
            )
        )
        if row is None:
            row = AlertSetting(rule=rule_key, stage=stage)
            db.add(row)
        if enabled is not None:
            row.enabled = None if enabled is True else False
        if hours is not None:
            row.threshold_hours = None if hours == rule.hours else hours
        if ways is not None:
            row.channels = "" if tuple(ways) == rule.ways else ",".join(ways)
        # Back on the default in every respect: the row has nothing left to say.
        if row.enabled is None and row.threshold_hours is None and not row.channels:
            db.delete(row)
    return policy(stage)[rule_key]


def _email(raised: list[Raised]) -> None:
    """Send the newly raised ones to the administrators.

    Only the new ones. A sweep runs whenever somebody opens a screen, and a
    rule that emailed on every sweep would send the same stuck inspection a
    hundred times before lunch - the dedup key that keeps the list honest keeps
    the mail honest too.

    Sent from the sweep, so nothing goes out while nobody is using the app.
    That is the shape of a system with no scheduler, and it is the limit that
    stops mattering the day there is one.
    """
    if not raised or not mail.enabled():
        return
    try:
        with session() as db:
            to = [
                person.email
                for person in db.scalars(select(User).where(User.is_admin.is_(True))).all()
                if person.state == "active"
            ]
    except Exception:  # noqa: BLE001 - the alerts are raised either way
        log.warning("could not read the roster to email %d alert(s)", len(raised))
        return
    if not to:
        return

    one = len(raised) == 1
    subject = raised[0].title if one else f"{len(raised)} inspections need attention"
    lines = [f"{found.title}{chr(10)}{found.detail}" for found in raised]
    foot = (
        "--" + chr(10) + "Raised by the size set inspection platform. Open the app to act "
        "on these or dismiss them; this address does not take replies."
    )
    mail.send(to, f"[Triburg QA] {subject}", (chr(10) * 2).join([*lines, foot]))
