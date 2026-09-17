"""Placing each reading at a second in the recording, so it can be played back.

A forward walk, never backwards: the inspection is dictated point of measure by
point of measure, so the readings and the recording run in the same order. That
constraint is the whole algorithm - the same reasoning `align_size` uses against
the spec sheet.

Two things the measurement forced, both worth keeping:

Search the WHOLE remaining stream, not a window. The measurements start minutes
into a spoken checklist, so a fixed lookahead never reached the first reading -
and because the pointer only advances on a hit, that one miss cascaded through
all forty. Monotonicity alone is enough of a constraint.

Interpolate what the index misses. One reading's name was never transcribed at
all, and it still happened, between the two either side of it. Spacing it in
that gap put it within a second of the right phrase. That is the difference
between "somewhere in thirteen minutes" and "in this twenty seconds".
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from services.config import Settings
from services.style_set import Alignment
from services.transcript import AudioPrepError, compress_for_upload

from .timing import WordIndex

log = logging.getLogger(__name__)

TOKEN = re.compile(r"[a-z0-9]+")
# Words too common to identify anything. Same list the aligner uses.
FILLER = frozenset({"the", "at", "to", "from", "of", "and", "a", "on", "in", "is", "each"})
# Below this share of a reading's words, the match is not worth trusting and the
# reading is interpolated from its neighbours instead.
MATCH_FLOOR = 0.5
# A point of measure is named in a breath. Matching over a fixed number of WORDS
# instead let two of them eighty seconds apart count as one phrase, which put a
# reading on the wrong repeat of its own name - every size says them all again.
PHRASE_SECONDS = 6.0
# How long a reading's playback runs when nothing follows it to bound it.
TAIL_SECONDS = 25.0
# Only for the LAST reading, which has nothing after it to bound the window.
# The anchor lands on the point of measure's name and the value follows a median
# 6.4s later, so a tail this long reaches it. It must never be applied where a
# following reading is known: that is how a cue came to swallow its neighbours.
MIN_WINDOW_SECONDS = 14.0
MAX_WINDOW_SECONDS = 45.0
# A reading is a name, a value and a verdict - "across front seam to seam
# relaxed, required measurement eleven five by eight, minus one by eight, okay".
# Nobody says that in under four seconds. A window shorter than this is not a
# short reading, it is two readings that collided: one anchored inside the
# other's utterance, which happens when consecutive points of measure share
# their wording. Style 7122 has five in a row - ACROSS SHOULDER / FRONT POSITION
# / FRONT SEAM / BACK POSITION / BACK SEAM - and "across back seam to seam
# relaxed" scores 80% against "across front seam to seam relaxed".
#
# It cannot be repaired here, because which of the two is in the wrong place is
# not knowable from the index. It CAN be refused, and that is the whole point:
# an operator played the wrong reading confirms a deviation against the wrong
# point of measure, and never finds out.
MIN_PLAUSIBLE_SECONDS = 4.0

# How long before the anchor playback opens.
#
# The anchor lands on the first word of the reading the index actually matched,
# which is rarely the first word the inspector said: "across shoulder seam to
# seam" anchors on "shoulder" when "across" was mis-transcribed, and the operator
# hears the reading already in progress. Three seconds is about two words of
# run-up at dictation pace.
#
# Clamped to half the gap back to the previous anchor, never taken flat. The
# readings here sit a median 5s apart and some are 2s apart, so a flat lead-in
# would open inside the PREVIOUS reading's utterance - the same wrong-cell
# playback as an overrun, arriving from the other side.
LEAD_SECONDS = 3.0

# How far past the previous reading a match may sit before it is disbelieved.
#
# Every point of measure is read again for every size, so the same phrase occurs
# once per size block. When a reading's own utterance is mis-transcribed - the
# index has "we spend height" where the inspector said "waistband height" - the
# search walks on and finds a perfect match in the NEXT size's block instead.
# The pointer only moves forward, so that one theft drags every later reading a
# whole block along with it.
#
# Readings land a median 5s apart, so 45s is nine points of measure: far enough
# to step over a genuine skip, nowhere near the minutes between size blocks.
# Beyond it an interpolated guess between known neighbours is worth more than a
# confident landing in the wrong size.
#
# Measured on one inspection (style 2463): readings actually located went from
# 29 of 71 to 60, and the median gap between consecutive cues from 0.0s to 4.9s
# - which is the difference between every cell playing the same fourteen
# seconds and each one playing its own reading. Anything from 15s to 30s scores
# identically there, so this sits at the top of a wide flat plateau rather than
# on a peak.
#
# ponytail: one recording is one data point. Re-measure on a floor that dictates
# at a very different pace before trusting the number.
MAX_JUMP_SECONDS = 30.0

# How much of a reading's identity is the number it carries, against the name of
# the point of measure. The name alone is weak evidence: the sheet repeats every
# name once per size, and the one that matters most is often the one speech
# recognition mangled - the index holds "we spend height" where the inspector
# said "waistband height". The value does not repeat that way. "twenty six three
# quarter" occurs once in the whole recording.
#
# Weighted rather than used as a tiebreak, because it has to be able to overturn
# a name match: the misheard reading above scores 1/2 on its own words at the
# right moment and 1/1 at the wrong one, and only the number can tell them apart.
# How much of the number has to turn up before it counts as corroboration.
# Half: "twenty six three quarter" losing a word to crosstalk is ordinary, and
# the name still has to clear MATCH_FLOOR on its own before this is consulted.
VALUE_FLOOR = 0.5

# Spoken forms of a measurement. "26 3/4" is said "twenty six three quarter",
# "1 3/8" as "one three by eight", "5 1/4" as "five and a quarter".
ONES = (
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen",
)  # fmt: skip
TENS = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")
# Said by name rather than as a ratio. Everything else is "<n> by <d>".
NAMED_FRACTIONS = {(1, 2): ("half",), (1, 4): ("quarter",), (3, 4): ("three", "quarter")}


def _spoken_number(whole: int) -> list[str]:
    if whole < len(ONES):
        return [ONES[whole]]
    if whole < 100:
        tens, unit = divmod(whole, 10)
        return [TENS[tens]] + ([ONES[unit]] if unit else [])
    return []


def _value_tokens(value: Fraction | None) -> list[str]:
    """The words a measurement is read aloud as, for matching against the index.

    "by" is deliberately absent: every fraction on the sheet is spoken with it,
    so it appears in nearly every window and would inflate every score equally.
    """
    if value is None or value < 0:
        return []
    whole, part = divmod(abs(value), 1)
    tokens = _spoken_number(int(whole)) if whole or not part else []
    if part:
        named = NAMED_FRACTIONS.get((part.numerator, part.denominator))
        tokens += list(named) if named else [
            *_spoken_number(part.numerator),
            *_spoken_number(part.denominator),
        ]
    # Deduplicated, keeping order: "5 5/8" would otherwise score "five" twice.
    return list(dict.fromkeys(tokens))


@dataclass(frozen=True)
class Cue:
    """Where one reading is in the recording."""

    row: int  # report number
    # Where playback opens - a little before the anchor, so the reading is not
    # already under way when the operator hears it.
    start: float
    end: float
    # Where the reading was actually placed. Kept apart from `start` because
    # every judgement about this cue is made against the reading, not against
    # its run-up: how long the reading is, and whether it runs into the next.
    anchor: float
    # False when the index never caught this reading's name and it was placed
    # between its neighbours instead. Shown to the operator rather than hidden:
    # an approximate cue that looks exact is worse than one that admits it.
    exact: bool


def _tokens(text: str) -> list[str]:
    return [t for t in TOKEN.findall(text.lower()) if t not in FILLER]


def cues(alignment: Alignment, index: WordIndex) -> dict[int, Cue]:
    """A playback window for every reading, keyed by report number."""
    readings = sorted(alignment.rows, key=lambda row: row.number)
    if not readings or not index.words:
        return {}

    flat = [word.text.lower().strip(" .,!?") for word in index.words]
    placed: list[tuple[int, float | None]] = []
    pointer = 0
    # Where the last reading was actually found, so a wild jump can be caught,
    # which size it belonged to, and how many readings have gone unplaced since.
    anchored: float | None = None
    anchored_size = ""
    skipped = 0

    for reading in readings:
        want = _tokens(reading.spoken)
        wanted = set(want)
        # What the inspector read off the tape, in words. Far more selective
        # than the name: the name comes round once per size, the number does not.
        figures = _value_tokens(reading.heard)
        # Two ways to settle a reading, tried in that order.
        #
        # `agreed` is the first window where the NAME and the NUMBER both land.
        # That is the strong claim, and taking the first one rather than the
        # best one matters: the best is often a later size block, where the same
        # point of measure is read again with a different value.
        #
        # `best_span` is the fallback - the best the words manage on their own -
        # for the readings whose number the index mangled.
        agreed, best_named, best_span = None, 0.0, None
        if want:
            edge = pointer
            for start in range(pointer, len(flat)):
                opened = index.words[start].start
                edge = max(edge, start)
                while (
                    edge + 1 < len(flat)
                    and index.words[edge + 1].start - opened <= PHRASE_SECONDS
                ):
                    edge += 1
                window = set(flat[start : edge + 1])
                named = sum(1 for token in want if token in window) / len(want)
                if named > best_named:
                    best_named, best_span = named, (start, edge)
                if named >= MATCH_FLOOR and figures:
                    spoken = sum(1 for token in figures if token in window) / len(figures)
                    if spoken >= VALUE_FLOOR:
                        agreed = (start, edge)
                        break
                if not figures and named == 1.0:
                    break

        best_span = agreed or best_span
        if best_span is None or (agreed is None and best_named < MATCH_FLOOR):
            placed.append((reading.number, None))
            skipped += 1
            continue

        spoken_at = [i for i in range(best_span[0], best_span[1] + 1) if flat[i] in wanted]
        when = index.words[spoken_at[0]].start
        # The allowance covers every reading since the last anchor, because a
        # reading the index missed leaves a legitimately wider gap behind it.
        # A change of size is exempt outright: the inspector works one size at a
        # time, so the first reading of a new block is minutes after the last of
        # the old one, and that is the sheet being read as intended.
        allowed = MAX_JUMP_SECONDS * (skipped + 1)
        same_block = anchored is not None and reading.size == anchored_size
        if same_block and when - anchored > allowed:
            # Too far ahead to be this reading; almost certainly the same point
            # of measure being read again for the next size. A guess between
            # known neighbours beats a confident landing in the wrong block.
            placed.append((reading.number, None))
            skipped += 1
            continue
        # Open on the first word actually asked for, not on the window's first
        # word. The window is six seconds wide and the phrase can sit anywhere
        # inside it, so anchoring on its opening started playback mid-way
        # through the PREVIOUS reading.
        placed.append((reading.number, when))
        anchored, anchored_size, skipped = when, reading.size, 0
        # Then step past the whole phrase. Advancing a single word let the next
        # reading re-match the utterance just consumed: three consecutive points
        # of measure anchored at 534.5s, 536.7s and 537.6s and, each padded out
        # to the minimum window, played the same fourteen seconds of audio.
        pointer = spoken_at[-1] + 1

    guessed = _interpolate(placed)
    return _windows(placed, guessed, index.duration)


def _interpolate(placed: list[tuple[int, float | None]]) -> set[int]:
    """Space unplaced readings evenly between the ones either side of them.

    Returns the readings placed this way, because a cue that was inferred rather
    than found has to say so.
    """
    guessed: set[int] = set()
    position = 0
    while position < len(placed):
        if placed[position][1] is not None:
            position += 1
            continue
        run = position
        while run < len(placed) and placed[run][1] is None:
            run += 1
        before = placed[position - 1][1] if position else None
        after = placed[run][1] if run < len(placed) else None
        if before is not None and after is not None:
            step = (after - before) / (run - position + 1)
            for offset, index in enumerate(range(position, run), start=1):
                placed[index] = (placed[index][0], before + step * offset)
                guessed.add(placed[index][0])
        position = run
    return guessed


def _windows(
    placed: list[tuple[int, float | None]], guessed: set[int], duration: float
) -> dict[int, Cue]:
    """Each reading runs until the next one starts, within sane bounds."""
    known = [(number, at) for number, at in placed if at is not None]
    out: dict[int, Cue] = {}
    for position, (number, at) in enumerate(known):
        previous = known[position - 1][1] if position else None
        following = known[position + 1][1] if position + 1 < len(known) else None
        if following is None:
            # Nothing after it to run into, so the floor is safe here: it only
            # decides how much of the tail to offer.
            end = max(at + MIN_WINDOW_SECONDS, min(at + TAIL_SECONDS, at + MAX_WINDOW_SECONDS))
        else:
            # The next reading's own anchor is EVIDENCE about where this one
            # ends; the minimum window is a guess. Evidence wins. Padding past
            # it is what made a cell play the readings below it - on one real
            # inspection 91 of 99 cues ran into the next reading and 37 ran
            # through the one after that.
            end = min(following, at + MAX_WINDOW_SECONDS)
        if duration:
            end = min(end, duration)
        # Too short to hold a reading: two of them landed on one utterance, so
        # this cue is not trustworthy even though it was "found". Demoted rather
        # than dropped - the operator still gets somewhere to listen, and is
        # told not to take it at face value.
        trustworthy = number not in guessed and (end - at) >= MIN_PLAUSIBLE_SECONDS
        # Half the gap at most: the run-up may never reach back into the reading
        # before this one.
        lead = LEAD_SECONDS if previous is None else min(LEAD_SECONDS, (at - previous) / 2)
        out[number] = Cue(
            row=number, start=max(0.0, at - lead), end=end, anchor=at, exact=trustworthy
        )
    return out


# Where a seekable copy of a recording is kept, beside its word index.
PLAYABLE_SUFFIX = ".play.mp3"


def playable_path_for(recording: Path, settings: Settings) -> Path:
    return settings.transcripts_dir / f"{recording.stem}{PLAYABLE_SUFFIX}"


def playable_copy(recording: Path, settings: Settings) -> Path:
    """A copy of `recording` the browser can seek accurately, built once and cached.

    Cues are useless if the player cannot act on them, and inspections arrive as
    whatever the phone or the browser produced. Two of those cannot be seeked:

    - **VBR MP3 with no Xing header.** The browser reads the first frame's
      bitrate and assumes it holds throughout. On the reference recording that
      frame says 32 kbps against a true average of 96, so the timeline it builds
      is three times too long and every cue lands at a third of its real
      position - which is every cell playing the same early stretch of audio.
    - **WebM from MediaRecorder**, which carries neither a Cues element nor a
      duration, so `<audio>` cannot seek it at all.

    Constant bitrate gives an exact byte-to-second mapping, and re-encoding
    leaves the timeline alone, so the word index built from the original stays
    valid against this copy.

    Falls back to the original on any ffmpeg failure: approximate seeking is
    worth more than a dead player.
    """
    cached = playable_path_for(recording, settings)
    if cached.is_file() and cached.stat().st_mtime >= recording.stat().st_mtime:
        return cached
    try:
        log.info("building a seekable copy of %s", recording.name)
        return compress_for_upload(recording, cached)
    except AudioPrepError as exc:
        log.warning("could not re-encode %s for playback: %s", recording.name, exc)
        return recording
