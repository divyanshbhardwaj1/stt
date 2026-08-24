"""Matching what was said to the rows of the style set, and judging each value.

The inspector works down the sheet in order, one size at a time, so this is
sequence alignment against a known list rather than open-ended matching. Reading
in order is what makes it reliable: position, wording and the expected value all
have to agree before a row is accepted.

Once a spoken measurement is tied to a POM, the verdict is arithmetic —
`deviation = measured - spec`, checked against that row's tolerance band — not a
judgement the model has to make.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from fractions import Fraction

from services.measurements import check_tolerance, parse

from .spec_sheet import PomRow, StyleSet

log = logging.getLogger(__name__)

# How far past the expected next row to look. The inspector occasionally skips a
# row or doubles back; beyond a handful of rows a match is more likely wrong
# than right.
LOOKAHEAD = 6

# Below this the spoken name resembles no nearby row well enough to claim a match.
MATCH_THRESHOLD = 0.32

# Wording decides. The measured value only separates rows whose names read almost
# alike ("across front seam to seam" against "across back seam to seam"), and
# only when their wording scores are this close.
#
# Value must never outrank a clear name match: an out-of-tolerance measurement
# would otherwise be handed to whichever neighbouring row it happens to fit,
# turning a real defect into a silent pass on the wrong POM.
WORDING_TIE = 0.12

NOISE = re.compile(r"[^a-z0-9 ]+")
FILLER = frozenset({"the", "at", "to", "from", "of", "and", "each", "on", "in", "a"})


@dataclass(frozen=True)
class AlignedRow:
    """One spoken measurement, tied to a POM and judged against its tolerance."""

    number: int
    size: str
    spoken: str
    pom: str
    description: str
    spec: Fraction | None
    measured: Fraction | None
    deviation: Fraction | None
    in_tolerance: bool | None
    confidence: float
    note: str
    # Position in the sheet, because a POM code is not unique: a style with a
    # lining repeats 1.01C, 4.22A and 4.27A for shell and lining alike.
    sheet_index: int = -1
    tolerance_minus: Fraction | None = None
    tolerance_plus: Fraction | None = None

    @property
    def matched(self) -> bool:
        return self.sheet_index >= 0

    @property
    def is_fail(self) -> bool:
        return self.in_tolerance is False

    @property
    def needs_attention(self) -> bool:
        """A human must look: out of tolerance, unmatched, or unjudged."""
        return self.is_fail or not self.matched or self.in_tolerance is None


@dataclass(frozen=True)
class Alignment:
    """Every spoken measurement, matched to the sheet where possible."""

    style_no: str
    sizes: tuple[str, ...]
    rows: tuple[AlignedRow, ...]

    def for_size(self, size: str) -> list[AlignedRow]:
        return [row for row in self.rows if row.size == size]

    def result_at(self, sheet_index: int, size: str) -> AlignedRow | None:
        """The reading for one sheet row at one size, located by position.

        By position rather than POM code: codes repeat across shell and lining
        rows, and matching on the code alone shows the same reading twice.
        """
        return next(
            (row for row in self.rows if row.sheet_index == sheet_index and row.size == size),
            None,
        )

    @property
    def failures(self) -> list[AlignedRow]:
        return [row for row in self.rows if row.is_fail]

    @property
    def unmatched(self) -> list[AlignedRow]:
        return [row for row in self.rows if not row.matched]

    @property
    def judged(self) -> list[AlignedRow]:
        return [row for row in self.rows if row.in_tolerance is not None]

    @property
    def verdict(self) -> str:
        """PASS when every judged measurement is inside its tolerance band."""
        if not self.judged:
            return ""
        return "FAIL CONDITIONALLY" if self.failures else "PASS"


def _words(text: str) -> list[str]:
    cleaned = NOISE.sub(" ", text.casefold())
    return [word for word in cleaned.split() if word not in FILLER]


def _wording_score(spoken: str, description: str) -> float:
    """How alike two point-of-measure names are, ignoring filler and punctuation."""
    left, right = " ".join(_words(spoken)), " ".join(_words(description))
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, left, right).ratio()


def _value_score(measured: Fraction | None, row: PomRow, size: str) -> float:
    """Whether the number heard is plausible for this row at this size."""
    spec = row.spec_for(size)
    if measured is None or spec is None or spec == 0:
        return 0.0
    band = max(
        abs(row.tolerance_minus or 0),
        abs(row.tolerance_plus or 0),
        Fraction(1, 8),
    )
    gap = abs(measured - spec)
    if gap <= band:
        return 1.0
    if gap <= band * 4:
        return 0.5
    return 0.0


def _judge(
    row: PomRow, size: str, value: str, stated_deviation: str
) -> tuple[Fraction | None, Fraction | None, bool | None]:
    """Measured value, deviation from spec, and whether it is inside tolerance."""
    spec = row.spec_for(size)
    measured = parse(value)
    stated = parse(stated_deviation)

    # An inspector who only calls the deviation still pins the measurement down.
    if measured is None and stated is not None and spec is not None:
        measured = spec + stated
    if measured is None or spec is None:
        return measured, stated, None
    if not row.is_measured:
        # Position and reference rows are read aloud but carry no tolerance,
        # so there is nothing to pass or fail against.
        return measured, measured - spec, None

    deviation, ok = check_tolerance(
        spec,
        measured,
        row.tolerance_minus if row.tolerance_minus is not None else Fraction(0),
        row.tolerance_plus if row.tolerance_plus is not None else Fraction(0),
    )
    return measured, deviation, ok


def align_size(
    spoken_rows: list[tuple[int, str, str, str, float, str]],
    sheet_rows: list[PomRow],
    size: str,
) -> list[AlignedRow]:
    """Walk one size's dictation against the sheet, in order.

    `spoken_rows` are (number, field, value, deviation, confidence, note) in the
    order they were said.
    """
    aligned: list[AlignedRow] = []
    pointer = 0

    for number, field, value, deviation, confidence, note in spoken_rows:
        measured = parse(value)
        candidates = []
        for offset in range(LOOKAHEAD):
            index = pointer + offset
            if index >= len(sheet_rows):
                break
            candidate = sheet_rows[index]
            candidates.append(
                (
                    _wording_score(field, candidate.description),
                    _value_score(measured, candidate, size),
                    index,
                )
            )

        best_index = None
        if candidates:
            best_wording = max(wording for wording, _, _ in candidates)
            if best_wording >= MATCH_THRESHOLD:
                # Among names that match about equally well, take the one whose
                # expected value fits, then the better name, then the nearer row.
                finalists = [c for c in candidates if best_wording - c[0] <= WORDING_TIE]
                best_index = max(finalists, key=lambda c: (c[1], c[0], -c[2]))[2]

        if best_index is None:
            aligned.append(
                AlignedRow(
                    number=number,
                    size=size,
                    spoken=field,
                    pom="",
                    description="",
                    spec=None,
                    measured=measured,
                    deviation=parse(deviation),
                    in_tolerance=None,
                    confidence=confidence,
                    note=note,
                )
            )
            continue

        row = sheet_rows[best_index]
        pointer = best_index + 1
        actual, gap, ok = _judge(row, size, value, deviation)
        aligned.append(
            AlignedRow(
                number=number,
                size=size,
                spoken=field,
                pom=row.pom,
                description=row.description,
                spec=row.spec_for(size),
                measured=actual,
                deviation=gap,
                in_tolerance=ok,
                confidence=confidence,
                note=note,
                sheet_index=best_index,
                tolerance_minus=row.tolerance_minus,
                tolerance_plus=row.tolerance_plus,
            )
        )
    return aligned


def align(sheet, style: StyleSet) -> Alignment:
    """Align a whole extracted inspection against its style set."""
    sheet_rows = style.spoken_rows()
    rows: list[AlignedRow] = []
    sizes: list[str] = []

    for size in sheet.sizes():
        if size not in style.sizes:
            log.warning("size %s is not in style set %s", size, style.style_no)
        sizes.append(size)
        spoken = [
            (number, row.field, row.value, row.deviation, row.confidence, row.note)
            for number, row in sheet.rows_in("measurement", size)
        ]
        rows.extend(align_size(spoken, sheet_rows, size))

    alignment = Alignment(style_no=style.style_no, sizes=tuple(sizes), rows=tuple(rows))
    log.info(
        "aligned %d measurements to style %s: %d judged, %d out of tolerance, %d unmatched",
        len(alignment.rows),
        style.style_no,
        len(alignment.judged),
        len(alignment.failures),
        len(alignment.unmatched),
    )
    return alignment
