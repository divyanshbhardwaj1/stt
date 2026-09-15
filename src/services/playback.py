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

from services.style_set import Alignment

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
# The anchor lands on the point of measure's name; the value follows a few
# seconds later. Measured median 6.4s, worst 13.2s, so a window that stops early
# cuts off the number the operator opened this to hear.
MIN_WINDOW_SECONDS = 14.0
MAX_WINDOW_SECONDS = 45.0


@dataclass(frozen=True)
class Cue:
    """Where one reading is in the recording."""

    row: int  # report number
    start: float
    end: float
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

    for reading in readings:
        want = _tokens(reading.spoken)
        best, best_at = 0.0, None
        if want:
            edge = pointer
            for start in range(pointer, len(flat)):
                opened = index.words[start].start
                edge = max(edge, start)
                while edge + 1 < len(flat) and index.words[edge + 1].start - opened <= PHRASE_SECONDS:
                    edge += 1
                window = set(flat[start : edge + 1])
                hit = sum(1 for token in want if token in window) / len(want)
                if hit > best:
                    best, best_at = hit, start
                if best == 1.0:
                    break
        if best_at is None or best < MATCH_FLOOR:
            placed.append((reading.number, None))
            continue
        placed.append((reading.number, index.words[best_at].start))
        pointer = best_at + 1

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
        following = known[position + 1][1] if position + 1 < len(known) else None
        end = following if following is not None else at + TAIL_SECONDS
        end = max(at + MIN_WINDOW_SECONDS, min(end, at + MAX_WINDOW_SECONDS))
        if duration:
            end = min(end, duration)
        out[number] = Cue(row=number, start=max(0.0, at), end=end, exact=number not in guessed)
    return out
