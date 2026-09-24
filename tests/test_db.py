"""The schema, and the one thing it exists to do: survive a restart.

Run against SQLite. Production is Postgres — the models avoid anything only
one of them has, and the migration is exercised on both in CI — but a test
suite that needs a server running is a test suite people stop running.
"""

from __future__ import annotations

import time
from fractions import Fraction
from pathlib import Path

import pytest

from api.jobs import DONE, FAILED, RUNNING
from services.db import (
    DatabaseJobStore,
    Inspection,
    Reading,
    configure,
    create_all,
    from_sixteenths,
    rebuild_readings,
    reset,
    session,
    to_sixteenths,
)


@pytest.fixture
def db(tmp_path: Path):
    """A fresh database per test, and no leakage between them."""
    reset()
    configure(f"sqlite:///{tmp_path / 'test.db'}")
    create_all()
    yield
    reset()


# ---------------------------------------------------------------- fractions
def test_measurements_survive_the_round_trip_exactly():
    """Every value on these sheets is a binary fraction, so this is exact.

    Not approximately exact. A sixteenth lost here is a sixteenth wrong on a
    document a vendor is holding.
    """
    for text in ["0", "1/16", "1/8", "1/4", "3/8", "1/2", "3/4", "11 5/8", "26 3/4", "-1 1/4"]:
        value = Fraction(text.split()[0]) if " " not in text else None
        original = _inches(text)
        assert from_sixteenths(to_sixteenths(original)) == original, text
        del value


def _inches(text: str) -> Fraction:
    sign = -1 if text.startswith("-") else 1
    parts = text.lstrip("-").split()
    total = sum(Fraction(part) for part in parts)
    return sign * total


def test_a_finer_measurement_is_rounded_and_says_so(caplog):
    """A thirty-second means the source document is not what we think it is.

    Rounded rather than refused - losing the row would lose more - but the
    warning is the evidence that something upstream changed.
    """
    with caplog.at_level("WARNING"):
        assert to_sixteenths(Fraction(1, 32)) == 1
    assert "finer than a sixteenth" in caplog.text


def test_nothing_is_a_measurement_of_none():
    assert to_sixteenths(None) is None
    assert from_sixteenths(None) is None


# ------------------------------------------------------------------- restart
def test_a_finished_job_is_still_there_after_a_restart(db):
    store = DatabaseJobStore()
    job = store.create("7122(4).mp3", style_no="7122")
    job.status = DONE
    # The output base name, which is NOT the recording's filename: the pipeline
    # versions a name that is already taken, so the two part company on the
    # second run of the same style.
    job.name = "7122(4)"
    job.rows, job.judged, job.unconfirmed = 74, 71, 3
    job.sizes = ["S", "M", "L", "XL"]
    job.files = {"report": Path("data/output/7122(4).pdf")}
    job.graded, job.graded_style_no = True, "7122"
    store.save(job)

    # A new process, the same database.
    revived = DatabaseJobStore()
    back = revived.get(job.id)
    assert back is not None
    assert back.status == DONE
    assert back.rows == 74
    assert back.unconfirmed == 3
    assert back.sizes == ["S", "M", "L", "XL"]
    assert back.files["report"] == Path("data/output/7122(4).pdf")
    assert back.graded_style_no == "7122"
    # Every output is named for this, and the audit view looks up
    # `<name>.json` to find the extraction. It went missing once, and the
    # symptom was a 410 on a report that was on disk the whole time.
    assert back.name == "7122(4)"


def test_a_job_interrupted_by_the_restart_is_reported_as_failed(db):
    """It is not still running: the process that was running it is gone.

    Saying "running" would leave an operator watching a progress line that
    will never move, and the recording is still on disk to re-run.
    """
    store = DatabaseJobStore()
    job = store.create("mid-flight.mp3")
    job.status = RUNNING
    job.message = "second reading"
    store.save(job)

    back = DatabaseJobStore().get(job.id)
    assert back.status == FAILED
    assert "restarted" in back.error
    assert "Process the recording again" in back.error

    # And it stays failed: the next restart must not resurrect it as running.
    assert DatabaseJobStore().get(job.id).status == FAILED


def test_jobs_come_back_newest_first(db):
    store = DatabaseJobStore()
    for name in ["first.mp3", "second.mp3", "third.mp3"]:
        store.create(name)
        time.sleep(0.001)  # created_at orders them

    assert [job.filename for job in DatabaseJobStore().all()] == [
        "third.mp3",
        "second.mp3",
        "first.mp3",
    ]


def test_the_extraction_is_stored_whole(db):
    """It is the source of truth, not a set of columns to be reassembled."""
    store = DatabaseJobStore()
    job = store.create("7122(4).mp3")
    store.record_extraction(job, {"style_no": "7122", "rows": [{"pom": "1.01A"}]})

    with session() as s:
        row = s.get(Inspection, job.id)
        assert row.extraction["style_no"] == "7122"
        assert row.extraction["rows"][0]["pom"] == "1.01A"
        assert row.schema_version == 1


def test_the_recording_is_found_again_by_its_hash(db):
    store = DatabaseJobStore()
    job = store.create("7122(4).mp3")
    store.record_recording(job, "recordings/7122(4).mp3", sha256="a" * 64)

    with session() as s:
        row = s.get(Inspection, job.id)
        assert row.recording_key == "recordings/7122(4).mp3"
        assert row.content_sha256 == "a" * 64


# ------------------------------------------------------------------ readings
GRID = {
    "rows": [
        {"kind": "note", "pom": "*", "description": "DISCLAIMER"},
        {
            "sheet_index": 2,
            "pom": "1.01A",
            "description": "FRONT LENGTH FROM HPS TO CF",
            "cells": {
                "M": {
                    "row": 12,
                    "spec": "21 1/2",
                    "deviation": "-1/8",
                    "measured": "21 3/8",
                    "verdict": "deviation",
                    "state": "pass",
                    "confidence": 0.82,
                    "disputed": False,
                    "edited": False,
                },
                "L": {
                    "row": 13,
                    "spec": "22 1/8",
                    "deviation": "",
                    "measured": "",
                    "verdict": "",
                    "state": "unconfirmed",
                    "confidence": None,
                    "disputed": False,
                    "edited": True,
                },
            },
        },
    ]
}


def test_readings_are_rebuilt_from_the_grid(db):
    store = DatabaseJobStore()
    job = store.create("7122(4).mp3")

    with session() as s:
        assert rebuild_readings(s, job.id, GRID) == 2

    with session() as s:
        rows = s.query(Reading).order_by(Reading.size).all()
        assert [r.size for r in rows] == ["L", "M"]

        m = next(r for r in rows if r.size == "M")
        assert m.pom == "1.01A"
        assert m.spec_text == "21 1/2"
        assert m.spec_sixteenths == 344  # 21.5 inches, exactly
        assert m.deviation_text == "-1/8"
        assert m.deviation_sixteenths == -2
        assert m.measured_sixteenths == 342  # and 344 - 2 = 342
        assert m.confidence == 82
        assert m.state == "pass"

        gap = next(r for r in rows if r.size == "L")
        assert gap.state == "unconfirmed"
        assert gap.confidence is None
        assert gap.edited is True


def test_a_note_row_is_not_a_reading(db):
    """Free text printed between the measurements is not a measurement."""
    store = DatabaseJobStore()
    job = store.create("7122(4).mp3")
    with session() as s:
        rebuild_readings(s, job.id, GRID)
    with session() as s:
        assert s.query(Reading).filter(Reading.pom == "*").count() == 0


def test_rebuilding_replaces_rather_than_accumulates(db):
    """The extraction is the truth; two sets of rows would be a third opinion."""
    store = DatabaseJobStore()
    job = store.create("7122(4).mp3")

    with session() as s:
        rebuild_readings(s, job.id, GRID)
    with session() as s:
        rebuild_readings(s, job.id, GRID)

    with session() as s:
        assert s.query(Reading).count() == 2


def test_deleting_an_inspection_takes_its_readings_with_it(db):
    store = DatabaseJobStore()
    job = store.create("7122(4).mp3")
    with session() as s:
        rebuild_readings(s, job.id, GRID)

    with session() as s:
        s.delete(s.get(Inspection, job.id))

    with session() as s:
        assert s.query(Reading).count() == 0


# ------------------------------------------------------------- no database
def test_without_a_url_there_is_no_database():
    """The fallback the app relies on while this is being adopted."""
    reset()
    from services.db import enabled

    assert configure("") is None
    assert not enabled()


def test_the_report_tables_come_back_after_a_restart(db, settings, monkeypatch):
    """The counts survive as columns; the rows behind them are rebuilt.

    A revived job that says "2 measurements out of tolerance" above an empty
    table reads as a bug in the grading rather than in the bookkeeping.
    """
    from api import app as api
    from api.jobs import detail_rows

    store = DatabaseJobStore()
    job = store.create("7122(4).mp3", style_no="7122")
    job.status, job.name, job.graded = DONE, "7122(4)", True
    job.unconfirmed, job.out_of_tolerance, job.flagged = 3, 2, 4
    job.unconfirmed_rows = [{"no": 1, "size": "M", "pom": "1.22A"}]
    store.save(job)

    back = DatabaseJobStore().get(job.id)
    assert back is not None
    # Derived, so deliberately not stored.
    assert back.unconfirmed_rows == []
    assert back.unconfirmed == 3

    # And rebuilt on the way out, from whatever the extraction says.
    rebuilt = []
    monkeypatch.setattr(api, "_graded_sheet", lambda job, settings: ("sheet", "style"))
    monkeypatch.setattr(api, "align", lambda sheet, style: "alignment")
    monkeypatch.setattr(
        api, "detail_rows", lambda job, sheet, alignment: rebuilt.append((sheet, alignment))
    )
    api._rehydrate(back, settings)

    assert rebuilt == [("sheet", "alignment")]
    assert detail_rows is not None  # the one implementation both paths share
