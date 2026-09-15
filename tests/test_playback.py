"""Placing readings in the recording so they can be listened back to.

The engine choice here was measured, not assumed: whisper-1 placed 40 of 40
readings on an English-dominant inspection but captured 391 words against
gpt-transcribe's 2236 on a Hindi-dominant one, all in Devanagari. Half this
floor's speech is Hindi, so the index has to come from somewhere else.
"""

import json

import pytest

from services.playback import MATCH_FLOOR, cues
from services.style_set.alignment import AlignedRow, Alignment
from services.timing import TimingError, WordIndex, index_path_for, word_index


def _index(pairs, duration=120.0):
    return WordIndex.from_payload(
        {"duration": duration, "words": [{"w": w, "s": s, "e": s + 0.3} for w, s in pairs]}
    )


def _reading(number, spoken, size="M"):
    return AlignedRow(
        number=number, size=size, spoken=spoken, pom="1.01A", description=spoken,
        spec=None, measured=None, deviation=None, in_tolerance=None, confidence=1.0, note="",
    )


def _alignment(*readings):
    return Alignment(style_no="7270", sizes=("M",), rows=tuple(readings))


def test_each_reading_is_placed_where_it_was_said():
    index = _index([
        ("checklist", 1.0), ("comments", 2.0),            # the spoken preamble
        ("front", 40.0), ("length", 40.5), ("26", 44.0),
        ("back", 70.0), ("length", 70.5), ("28", 74.0),
    ])
    found = cues(_alignment(_reading(1, "Front length"), _reading(2, "Back length")), index)

    assert set(found) == {1, 2}
    assert found[1].start == pytest.approx(40.0)
    assert found[2].start == pytest.approx(70.0)
    assert all(cue.exact for cue in found.values())


def test_the_search_is_not_windowed():
    """The measurements start minutes into a spoken checklist.

    A fixed forward window never reached the first reading, and because the
    pointer only advances on a hit that one miss cascaded through all forty -
    0 of 40 placed. Monotonicity alone is the constraint.
    """
    preamble = [("checklist", float(i)) for i in range(400)]
    index = _index(preamble + [("front", 500.0), ("length", 500.5)], duration=600.0)

    found = cues(_alignment(_reading(1, "Front length")), index)
    assert found[1].start == pytest.approx(500.0)


def test_readings_run_in_order_even_when_a_name_repeats():
    """Every size repeats the same points of measure, so the second "front
    length" is a different reading and must land on the later one."""
    index = _index([
        ("front", 10.0), ("length", 10.5),
        ("front", 90.0), ("length", 90.5),
    ], duration=200.0)

    found = cues(_alignment(_reading(1, "Front length", "M"), _reading(2, "Front length", "L")), index)
    assert found[1].start == pytest.approx(10.0)
    assert found[2].start == pytest.approx(90.0)


def test_a_reading_the_index_never_caught_is_placed_between_its_neighbours():
    """It still happened, and it happened between the two either side of it.

    Measured: doing this put the one unmatched reading within a second of the
    right phrase. Marked inexact, because a cue that was inferred must say so.
    """
    index = _index([
        ("front", 10.0), ("length", 10.5),
        ("sleeve", 70.0), ("opening", 70.5),
    ], duration=200.0)

    found = cues(
        _alignment(
            _reading(1, "Front length"),
            _reading(2, "Bottom hem height"),  # absent from the index entirely
            _reading(3, "Sleeve opening"),
        ),
        index,
    )
    assert 10.0 < found[2].start < 70.0, "placed inside the gap it must have happened in"
    assert found[2].exact is False
    assert found[1].exact and found[3].exact


def test_a_window_runs_long_enough_to_reach_the_value():
    """The anchor lands on the point of measure's NAME; the value follows a
    median 6.4s later and up to 13.2s. A window that stops early cuts off the
    number the operator opened this to hear."""
    index = _index([("front", 10.0), ("length", 10.5), ("back", 14.0), ("length", 14.5)],
                   duration=300.0)
    found = cues(_alignment(_reading(1, "Front length"), _reading(2, "Back length")), index)

    assert found[1].end - found[1].start >= 14.0


def test_nothing_is_placed_from_an_empty_index():
    assert cues(_alignment(_reading(1, "Front length")), _index([])) == {}


def test_a_weak_match_is_not_trusted():
    index = _index([("something", 10.0), ("unrelated", 11.0)], duration=60.0)
    found = cues(_alignment(_reading(1, "Front length from high point shoulder")), index)
    # One lone reading with nothing to interpolate between: better absent than wrong.
    assert found == {} or found[1].exact is False
    assert MATCH_FLOOR > 0


def test_without_a_key_the_reason_is_said_plainly(settings, tmp_path):
    """No key is not a fault, and the message has to be actionable."""
    recording = tmp_path / "rec.m4a"
    recording.write_bytes(b"audio")

    with pytest.raises(TimingError, match="DEEPGRAM_API_KEY"):
        word_index(recording, settings)


def test_a_cached_index_is_never_rebuilt(settings, tmp_path):
    """Indexing costs money; a second listen must not pay again."""
    recording = tmp_path / "rec.m4a"
    recording.write_bytes(b"audio")
    cached = index_path_for(recording, settings)
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps({"duration": 12.0, "words": [{"w": "hi", "s": 1.0, "e": 1.2}]}))

    # No key, so any attempt to build would raise. Reading the cache must not.
    index = word_index(recording, settings)
    assert index.duration == 12.0
    assert index.words[0].text == "hi"
