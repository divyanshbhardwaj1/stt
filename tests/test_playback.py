"""Placing readings in the recording so they can be listened back to.

The engine choice here was measured, not assumed: whisper-1 placed 40 of 40
readings on an English-dominant inspection but captured 391 words against
gpt-transcribe's 2236 on a Hindi-dominant one, all in Devanagari. Half this
floor's speech is Hindi, so the index has to come from somewhere else.
"""

import json
import subprocess
from fractions import Fraction
from pathlib import Path

import pytest

from services.playback import (
    LEAD_SECONDS,
    MATCH_FLOOR,
    MIN_PLAUSIBLE_SECONDS,
    MIN_WINDOW_SECONDS,
    _value_tokens,
    cues,
    playable_copy,
    playable_path_for,
)
from services.style_set.alignment import AlignedRow, Alignment
from services.timing import TimingError, WordIndex, index_path_for, word_index
from services.transcript import ffmpeg_executable


def _index(pairs, duration=120.0):
    return WordIndex.from_payload(
        {"duration": duration, "words": [{"w": w, "s": s, "e": s + 0.3} for w, s in pairs]}
    )


def _reading(number, spoken, size="M", heard=None):
    return AlignedRow(
        number=number, size=size, spoken=spoken, pom="1.01A", description=spoken,
        spec=None, measured=None, deviation=None, in_tolerance=None, confidence=1.0, note="",
        heard=heard,
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
    assert found[1].anchor == pytest.approx(40.0)
    assert found[2].anchor == pytest.approx(70.0)
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
    assert found[1].anchor == pytest.approx(500.0)


def test_readings_run_in_order_even_when_a_name_repeats():
    """Every size repeats the same points of measure, so the second "front
    length" is a different reading and must land on the later one."""
    index = _index([
        ("front", 10.0), ("length", 10.5),
        ("front", 90.0), ("length", 90.5),
    ], duration=200.0)

    found = cues(_alignment(_reading(1, "Front length", "M"), _reading(2, "Front length", "L")), index)
    assert found[1].anchor == pytest.approx(10.0)
    assert found[2].anchor == pytest.approx(90.0)


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
    assert 10.0 < found[2].anchor < 70.0, "placed inside the gap it must have happened in"
    assert found[2].exact is False
    assert found[1].exact and found[3].exact


def test_a_window_runs_long_enough_to_reach_the_value():
    """The anchor lands on the point of measure's NAME; the value follows a
    median 6.4s later and up to 13.2s. A window that stops early cuts off the
    number the operator opened this to hear."""
    index = _index([("front", 10.0), ("length", 10.5), ("back", 14.0), ("length", 14.5)],
                   duration=300.0)
    found = cues(_alignment(_reading(1, "Front length"), _reading(2, "Back length")), index)

    assert found[1].end - found[1].anchor >= 14.0


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


def test_the_same_name_in_the_next_size_is_not_mistaken_for_this_one():
    """The commonest way a cue lands on the wrong audio.

    Every point of measure is read again for every size. When a reading's own
    utterance is mis-transcribed - the index holds "we spend height" where the
    inspector said "waistband height" - the search walks on and finds a perfect
    match in the NEXT size's block. The pointer only moves forward, so that one
    theft drags every later reading a whole block along with it.
    """
    index = _index([
        ("waistband", 10.0), ("height", 10.5),        # reading 1, correctly
        ("we", 20.0), ("spend", 20.4), ("height", 20.8),  # reading 2, misheard
        ("waistband", 300.0), ("height", 300.5),      # the NEXT size's repeat
    ], duration=600.0)

    found = cues(
        _alignment(_reading(1, "Waistband height"), _reading(2, "Waistband height")),
        index,
    )
    assert found[1].anchor == pytest.approx(10.0)
    # Five minutes ahead is the next size being read, not this reading. With no
    # later reading to interpolate towards, it is offered no cue at all - which
    # is the honest answer: the cell says so rather than playing the wrong size.
    assert not any(cue.anchor == pytest.approx(300.0) for cue in found.values())


def test_a_cue_opens_on_the_phrase_not_on_the_window():
    """The match window is six seconds wide and the phrase can sit anywhere in it.

    Anchoring on the window's first word started playback mid-way through the
    previous reading, which is most of what made neighbouring cells sound alike.
    """
    index = _index([
        ("okay", 40.0), ("that", 40.3), ("is", 40.6), ("fine", 40.9),
        ("sleeve", 44.0), ("opening", 44.4),
    ], duration=200.0)

    found = cues(_alignment(_reading(1, "Sleeve opening")), index)
    assert found[1].anchor == pytest.approx(44.0), "must open on 'sleeve', not on 'okay'"



@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (Fraction(5, 4), ["one", "quarter"]),              # "one and a quarter"
        (Fraction(11, 8), ["one", "three", "eight"]),      # "one three by eight"
        (Fraction(107, 4), ["twenty", "six", "three", "quarter"]),  # "twenty six three quarter"
        (Fraction(39), ["thirty", "nine"]),                # "thirty nine"
        (Fraction(81, 2), ["forty", "half"]),              # "forty and a half"
        (None, []),
    ],
)
def test_a_measurement_knows_how_it_is_said_aloud(value, expected):
    """Matching against the index means matching words, not numbers."""
    assert _value_tokens(value) == expected


def test_the_number_rescues_a_reading_whose_name_was_misheard():
    """The case that made every cell play the same audio.

    The index holds "we spend height" where the inspector said "waistband
    height", so on its own words this reading scores better on the NEXT point of
    measure - which shares two of them - than on its own. The value is what
    separates them: 1 1/4 is spoken here, 1 3/8 is spoken there.
    """
    index = _index([
        ("we", 10.0), ("spend", 10.3), ("height", 10.6),
        ("one", 11.0), ("and", 11.2), ("a", 11.4), ("quarter", 11.6), ("okay", 11.9),
        ("waistband", 20.0), ("elastic", 20.3), ("height", 20.6),
        ("one", 21.0), ("three", 21.3), ("by", 21.5), ("eight", 21.8),
    ], duration=200.0)

    found = cues(
        _alignment(
            _reading(1, "Waistband height", heard=Fraction(5, 4)),
            _reading(2, "Waistband elastic height", heard=Fraction(11, 8)),
        ),
        index,
    )
    assert found[1].anchor < 20.0, "must stay on its own reading, not steal the next one"
    assert found[1].exact and found[2].exact
    assert found[2].anchor == pytest.approx(20.0)


def test_the_name_alone_still_settles_a_reading_with_no_usable_number():
    """A mangled value must cost corroboration, never the cue itself."""
    index = _index([("sleeve", 30.0), ("opening", 30.4), ("mumble", 31.0)], duration=200.0)

    found = cues(_alignment(_reading(1, "Sleeve opening", heard=None)), index)
    assert found[1].anchor == pytest.approx(30.0)
    assert found[1].exact

# ---------------------------------------------------------------- seekability


def _frames(path: Path):
    """Every MPEG audio frame's bitrate, so constant-rate can be asserted."""
    data = path.read_bytes()
    mpeg1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
    mpeg2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
    rates = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}
    found, index = [], 0
    while index < len(data) - 4:
        if data[index] == 0xFF and (data[index + 1] & 0xE0) == 0xE0:
            version = (data[index + 1] >> 3) & 3
            bitrate_index = data[index + 2] >> 4
            rate_index = (data[index + 2] >> 2) & 3
            padding = (data[index + 2] >> 1) & 1
            if version in rates and rate_index < 3 and 0 < bitrate_index < 15:
                rate = rates[version][rate_index]
                bitrate = (mpeg1 if version == 3 else mpeg2)[bitrate_index]
                if bitrate and rate:
                    found.append(bitrate)
                    index += int((144 if version == 3 else 72) * bitrate * 1000 / rate) + padding
                    continue
        index += 1
    return found


def test_the_served_copy_is_constant_bitrate(settings, tmp_path):
    """The cue is only as good as the browser's ability to act on it.

    A variable-bitrate MP3 with no seek header - what phones hand us - makes the
    browser read the first frame's rate and assume it holds throughout. On the
    reference recording that frame says 32 kbps against a true 96, so its
    timeline ran three times long and every reading played from the same early
    stretch of audio. Constant bitrate is what makes a second map to a byte.
    """
    source = tmp_path / "spoken.mp3"
    subprocess.run(
        [ffmpeg_executable(), "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "sine=frequency=300:duration=8", str(source)],
        check=True, capture_output=True,
    )  # fmt: skip

    played = playable_copy(source, settings)
    bitrates = set(_frames(played))
    assert len(bitrates) == 1, f"a seekable copy must be constant bitrate, got {sorted(bitrates)}"

    # The whole point: size and bitrate alone must recover the real duration,
    # because that is all the browser has to go on when it maps a cue to a byte.
    kbps = bitrates.pop()
    assert abs(played.stat().st_size * 8 / (kbps * 1000) - 8.0) < 1.0


def test_the_seekable_copy_is_built_once(settings, tmp_path):
    """Re-encoding every listen would pay for the same file over and over."""
    source = tmp_path / "spoken.mp3"
    subprocess.run(
        [ffmpeg_executable(), "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "sine=frequency=300:duration=3", str(source)],
        check=True, capture_output=True,
    )  # fmt: skip

    first = playable_copy(source, settings)
    stamp = first.stat().st_mtime_ns
    assert playable_copy(source, settings).stat().st_mtime_ns == stamp


def test_something_ffmpeg_cannot_read_still_plays(settings, tmp_path):
    """A failed re-encode must cost accurate seeking, never the player itself."""
    source = tmp_path / "broken.mp3"
    source.write_bytes(b"not audio")

    assert playable_copy(source, settings) == source
    assert not playable_path_for(source, settings).is_file()


def test_a_cue_never_runs_into_the_reading_after_it():
    """The symptom that started this: cells played the measurements below them.

    The minimum window was applied even when the next reading's anchor was
    already known, so it overrode a real boundary with a guess. On one real
    inspection 91 of 99 cues ran into the next reading and 37 ran through the
    one after that - readings there are a median 7.7s apart against a 14s floor.
    """
    # Four readings, each ~4s apart: far closer together than MIN_WINDOW_SECONDS.
    index = _index([
        ("front", 10.0), ("length", 10.4),
        ("back", 14.0), ("length", 14.4),
        ("sleeve", 18.0), ("opening", 18.4),
        ("hem", 22.0), ("height", 22.4),
    ], duration=300.0)
    found = cues(
        _alignment(
            _reading(1, "Front length"), _reading(2, "Back length"),
            _reading(3, "Sleeve opening"), _reading(4, "Hem height"),
        ),
        index,
    )

    assert len(found) == 4
    ordered = sorted(found.values(), key=lambda cue: cue.anchor)
    for cue, following in zip(ordered, ordered[1:]):
        assert cue.end <= following.anchor + 1e-6, (
            f"a cue ending at {cue.end} runs into the next reading at {following.anchor}"
        )


def test_the_last_reading_still_gets_a_tail():
    """It has nothing after it to run into, so the floor is safe there - and
    without it the final reading would be cut off mid-phrase."""
    index = _index([("front", 10.0), ("length", 10.4), ("back", 14.0), ("length", 14.4)],
                   duration=300.0)
    found = cues(_alignment(_reading(1, "Front length"), _reading(2, "Back length")), index)

    last = max(found.values(), key=lambda cue: cue.anchor)
    assert last.end - last.anchor >= MIN_WINDOW_SECONDS


def test_two_readings_that_collide_are_not_offered_as_certain():
    """The costly failure: playing the wrong reading and looking right.

    Style 7122 runs five near-identical names together - ACROSS SHOULDER / FRONT
    POSITION / FRONT SEAM / BACK POSITION / BACK SEAM - and "across back seam to
    seam relaxed" scores 80% against "across front seam to seam relaxed", well
    over the floor. One anchored inside the other's utterance and the readings
    between were crushed into under two seconds each.

    Which of the two is misplaced cannot be known from the index. That it IS
    misplaced can: nobody says a name, a value and a verdict in four seconds.
    """
    # Two readings anchored two seconds apart: on style 7122 this is exactly
    # what 1.23A and 1.25A did, leaving 1.24A between them with no room at all.
    index = _index([
        ("front", 10.0), ("length", 10.4),
        ("back", 12.0), ("width", 12.4),
        ("hem", 40.0), ("height", 40.4),
    ], duration=300.0)

    found = cues(
        _alignment(
            _reading(1, "Front length"),
            _reading(2, "Back width"),
            _reading(3, "Hem height"),
        ),
        index,
    )

    crushed = [cue for cue in found.values() if cue.end - cue.anchor < MIN_PLAUSIBLE_SECONDS]
    assert crushed, "this fixture is meant to collide two readings"
    assert all(not cue.exact for cue in crushed), (
        "a cue too short to hold a reading must never be offered as certain"
    )


def test_a_full_length_reading_is_still_trusted():
    """The guard must not demote every cue; then it would say nothing."""
    index = _index([
        ("front", 10.0), ("length", 10.4),
        ("sleeve", 25.0), ("opening", 25.4),
    ], duration=300.0)
    found = cues(_alignment(_reading(1, "Front length"), _reading(2, "Sleeve opening")), index)

    assert all(cue.exact for cue in found.values())
    assert min(cue.end - cue.anchor for cue in found.values()) >= MIN_PLAUSIBLE_SECONDS


def test_playback_opens_before_the_anchor():
    """The anchor is the first word MATCHED, not the first word said.

    "across shoulder seam to seam" anchors on "shoulder" when "across" came back
    mangled, and the operator hears the reading already under way.
    """
    index = _index([
        ("front", 10.0), ("length", 10.4),
        ("sleeve", 40.0), ("opening", 40.4),
    ], duration=300.0)
    found = cues(_alignment(_reading(1, "Front length"), _reading(2, "Sleeve opening")), index)

    assert found[2].anchor == pytest.approx(40.0)
    assert found[2].start == pytest.approx(40.0 - LEAD_SECONDS), "the full run-up, there is room"
    assert found[1].start == pytest.approx(7.0), "clamped at zero only when it must be"


def test_the_run_up_never_reaches_into_the_reading_before_it():
    """Readings 2s apart are ordinary here, and a flat lead-in would open inside
    the previous one - the wrong-cell playback arriving from the other side."""
    index = _index([
        ("front", 10.0), ("length", 10.2),
        ("back", 12.0), ("length", 12.2),
        ("hem", 14.0), ("height", 14.2),
    ], duration=300.0)
    found = cues(
        _alignment(
            _reading(1, "Front length"), _reading(2, "Back length"), _reading(3, "Hem height")
        ),
        index,
    )

    ordered = sorted(found.values(), key=lambda cue: cue.anchor)
    for cue, following in zip(ordered, ordered[1:], strict=False):
        assert following.start > cue.anchor, (
            f"a cue opening at {following.start} plays the reading anchored at {cue.anchor}"
        )
