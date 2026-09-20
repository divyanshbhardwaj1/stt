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

from services.measurements import check_tolerance, is_garment_fraction, parse

from .spec_sheet import PomRow, StyleSet

log = logging.getLogger(__name__)

# How far past the expected next row to look. The inspector occasionally skips a
# row or doubles back; beyond a handful of rows a match is more likely wrong
# than right.
LOOKAHEAD = 6

# How far back to look. The inspector sometimes reads a neighbouring pair the
# other way round — front neck drop and back neck drop on style 7147 — and a
# pointer that only ever moves forward cannot recover: it steps past the row it
# skipped and every following reading lands one row down the sheet. Kept tight,
# because a row already passed is usually passed for a reason.
LOOKBEHIND = 2

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
    # The absolute the inspector read aloud. Carried for the audit trail only:
    # it is the part speech recognition mangles, so it never decides a verdict.
    heard: Fraction | None = None
    # The inspector said "okay" rather than calling a deviation. Distinct from a
    # deviation that merely computes to zero, which is not the same claim.
    on_spec: bool = False
    # No verdict was captured for this point of measure. Not a pass, not a
    # failure — an unanswered question that a human has to settle against the
    # recording before the report goes anywhere.
    unconfirmed: bool = False

    @property
    def matched(self) -> bool:
        return self.sheet_index >= 0

    @property
    def is_fail(self) -> bool:
        return self.in_tolerance is False

    @property
    def disputed(self) -> bool:
        """The recording contradicts itself about this point of measure.

        Every reading is dictated twice over: an absolute, then a deviation. The
        absolute is not used to build the report - it is the part speech
        recognition mangles - but it is still a second statement about the same
        garment, and it should agree with one of two things: the spec, when the
        inspector is reading the sheet aloud, or the measurement itself, when
        they are calling what the tape says.

        Agreeing with neither means the two spoken numbers cannot both be right.
        Measured across the extractions on disk this is 7.6% of rows, and it is
        how "3, minus one" against a spec of 4 came to be reported as 5: the
        deviation was heard as "+1", and nothing compared it with the 3.

        Not a verdict of its own. The report is still built on spec + deviation,
        which remains the better of the two; this only says the operator should
        listen to this one before it goes out.
        """
        if self.heard is None or self.spec is None or self.measured is None:
            return False
        return self.heard != self.spec and self.heard != self.measured

    @property
    def needs_attention(self) -> bool:
        """A human must look: out of tolerance, unmatched, unjudged or unconfirmed."""
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
    def disputed(self) -> list[AlignedRow]:
        """Readings whose two spoken numbers do not reconcile."""
        return [row for row in self.rows if row.disputed]

    @property
    def judged(self) -> list[AlignedRow]:
        return [row for row in self.rows if row.in_tolerance is not None]

    @property
    def unconfirmed(self) -> list[AlignedRow]:
        """Points of measure whose verdict never made it out of the recording."""
        return [row for row in self.rows if row.unconfirmed]

    @property
    def verdict(self) -> str:
        """PASS only when every measurement was both heard and inside tolerance.

        A gap cannot pass. An unconfirmed point of measure is one nobody has
        ruled on, and a report that quietly counted it as good is the failure
        this whole stage exists to prevent — so the verdict says how many
        answers are still owed.
        """
        if self.failures:
            return "FAIL CONDITIONALLY"
        if self.unconfirmed:
            checks = _plural(len(self.unconfirmed), "CHECK")
            # Nothing judged at all: there is no pass here to be pending on, and
            # saying so would read as approval of a sheet nobody has ruled on.
            if not self.judged:
                return f"UNVERIFIED - {checks} OUTSTANDING"
            return f"PASS PENDING {checks}"
        if not self.judged:
            return ""
        return "PASS"


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}S"


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
    row: PomRow, size: str, value: str, stated_deviation: str, confirmed_okay: bool = False
) -> tuple[Fraction | None, Fraction | None, bool | None, bool, bool]:
    """Measurement, deviation, tolerance result, on-spec, and unconfirmed.

    The style set is authoritative for the measurement. The inspector dictates
    every point of measure as an absolute followed by either a deviation or
    "okay" — and the absolute is the part speech recognition mangles ("two
    ampere, one quarter" for 2 1/4, "3 sixteen" for 3/16), while the deviation
    phrase comes through clean. So the deviation is taken as stated and the
    measurement is rebuilt from the sheet as spec + deviation.

    A blank deviation is the spoken "okay", not missing data: no point of
    measure is left without one. The heard absolute is never used to derive a
    deviation — trusting it is what put mis-transcribed numbers on the report.
    """
    spec = row.spec_for(size)
    spoken = stated_deviation.strip()
    stated = parse(spoken)
    heard = parse(value)

    if spec is None:
        # A size this sheet does not grade. Nothing to rebuild from, and nothing
        # to judge against, so the recording is all there is.
        return heard, stated, None, False, False

    if spoken and stated is None:
        # Something was said, but it is not a signed deviation: "±1/8" is the
        # tolerance band quoted back, not a reading. Unconfirmed rather than
        # okay — a value nobody ruled on must not borrow a pass.
        return spec, None, None, False, True

    if not is_garment_fraction(stated):
        # A deviation in sixths or twenty-fifths was never read off a tape.
        # "minus one by sixteen" heard as "1/6" would otherwise turn a 1 3/8
        # spec into a reported 1 5/24. Treated as an unanswered question, the
        # same as any other verdict that did not come through, rather than
        # computed with and printed as though it were a measurement.
        log.warning(
            "%s %s: deviation %s is not a sixteenth of an inch; reporting it "
            "unconfirmed rather than measuring with it",
            row.pom,
            size,
            stated,
        )
        return spec, None, None, False, True

    if not spoken and not confirmed_okay:
        # No deviation and no spoken pass. Transcription drops these short words,
        # so silence is an open question, not a clean sheet. Legacy extractions
        # carry no verdict at all and land here too, which is honest: for those
        # we cannot tell an unspoken verdict from a lost one.
        return spec, None, None, False, True

    on_spec = not spoken
    deviation = Fraction(0) if on_spec else stated
    measured = spec + deviation

    if not row.is_measured:
        # Position and reference rows are read aloud but carry no tolerance,
        # so there is nothing to pass or fail against.
        return measured, deviation, None, on_spec, False

    _, ok = check_tolerance(
        spec,
        measured,
        row.tolerance_minus if row.tolerance_minus is not None else Fraction(0),
        row.tolerance_plus if row.tolerance_plus is not None else Fraction(0),
    )
    return measured, deviation, ok, on_spec, False


# One dictated reading: (number, field, value, deviation, confidence, note,
# confirmed_okay), optionally followed by a `pom_index` pin.
SpokenRow = (
    tuple[int, str, str, str, float, str, bool] | tuple[int, str, str, str, float, str, bool, int]
)


def align_size(
    spoken_rows: list[SpokenRow],
    sheet_rows: list[PomRow],
    size: str,
) -> list[AlignedRow]:
    """Walk one size's dictation against the sheet, in order.

    `spoken_rows` are (number, field, value, deviation, confidence, note,
    confirmed_okay) in the order they were said, optionally followed by a
    `pom_index` pin. `confirmed_okay` is True only when the inspector was heard
    to pass the row aloud — never inferred from a blank deviation, which is
    equally consistent with the transcription having dropped the word.

    A pinned row skips matching entirely. The pin is only ever set by a human
    settling that exact cell in the audit view, and there is nothing for a
    fuzzy match to improve on when the point of measure is already known. It
    also fixes the case wording alone cannot reach: the first reading on a size
    nobody dictated has no earlier row to advance the pointer, so a POM further
    down the sheet sits outside the forward window and would never be found.
    """
    aligned: list[AlignedRow] = []
    pointer = 0
    # Sheet rows already spoken for. This is what keeps two readings off the
    # same row, which the forward-only pointer used to guarantee on its own.
    claimed: set[int] = set()

    for spoken in spoken_rows:
        number, field, value, deviation, confidence, note, confirmed_okay = spoken[:7]
        pinned = spoken[7] if len(spoken) > 7 else -1
        measured = parse(value)

        # A pinned row is not a guess to improve on: a human settled this exact
        # cell, so it goes straight to the matched path below.
        best_index = pinned if 0 <= pinned < len(sheet_rows) and pinned not in claimed else None
        candidates = []
        search = (
            range(max(pointer - LOOKBEHIND, 0), pointer + LOOKAHEAD) if best_index is None else ()
        )
        for index in search:
            if index >= len(sheet_rows):
                break
            if index in claimed:
                continue
            candidate = sheet_rows[index]
            candidates.append(
                (
                    _wording_score(field, candidate.description),
                    _value_score(measured, candidate, size),
                    index,
                )
            )

        if best_index is None and candidates:
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
                    heard=measured,
                )
            )
            continue

        row = sheet_rows[best_index]
        claimed.add(best_index)
        # Never backwards: a reading that reclaimed a skipped row must not send
        # the search back over ground already covered.
        pointer = max(pointer, best_index + 1)
        actual, gap, ok, on_spec, unconfirmed = _judge(row, size, value, deviation, confirmed_okay)
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
                heard=measured,
                on_spec=on_spec,
                unconfirmed=unconfirmed,
            )
        )
    return aligned


@dataclass(frozen=True)
class SizeEvidence:
    """What the recording's own numbers say about which size was measured."""

    assigned: str
    best: str
    votes: dict[str, int]

    @property
    def informative(self) -> int:
        """Rows that could tell one size from another at all."""
        return max(self.votes.values()) if self.votes else 0

    @property
    def disagrees(self) -> bool:
        return self.best != self.assigned and self.votes.get(self.best, 0) > self.votes.get(
            self.assigned, 0
        )


def check_size_attribution(alignment: Alignment, style: StyleSet) -> list[SizeEvidence]:
    """Which size column the spoken absolutes actually fit.

    The single most expensive thing this pipeline can get wrong is the size. A
    sheet graded against the wrong column is wrong in every row at once, and it
    looks entirely plausible: the numbers are real, the arithmetic is right, and
    only a reviewer with the spec sheet open would catch it.

    It is also the least defended. Nothing announces the size reliably - one
    inspection on disk never says it at all, so `align` fell back to the sheet's
    base size, as it is documented to. The garment was two sizes off that, and
    all forty readings were judged against the wrong grade with nothing to say
    so.

    The recording checks itself, though. Every point of measure is dictated as an
    absolute before its deviation, and those absolutes are read off one column.
    Counting which column they land in settles it. Only rows whose spec varies
    between sizes carry information, so constant rows are skipped rather than
    voting for every size at once.
    """
    spoken_rows = style.spoken_rows()
    by_size: dict[str, list[AlignedRow]] = {}
    for row in alignment.rows:
        by_size.setdefault(row.size, []).append(row)

    findings: list[SizeEvidence] = []
    for assigned, readings in by_size.items():
        votes = {size: 0 for size in style.sizes}
        for reading in readings:
            if not reading.matched or reading.heard is None:
                continue
            pom = spoken_rows[reading.sheet_index]
            if len({pom.specs.get(size) for size in style.sizes}) <= 1:
                continue  # the same value in every column decides nothing
            for size in style.sizes:
                if pom.specs.get(size) == reading.heard:
                    votes[size] += 1

        if not any(votes.values()):
            continue
        best = max(votes, key=lambda size: (votes[size], size == assigned))
        finding = SizeEvidence(assigned=assigned, best=best, votes=votes)
        findings.append(finding)
        if finding.disagrees:
            log.warning(
                "size attribution: readings filed as %s match the %s column "
                "(%d vs %d informative rows) on style %s",
                assigned,
                best,
                votes[best],
                votes.get(assigned, 0),
                style.style_no,
            )
    return findings


def align(sheet, style: StyleSet) -> Alignment:
    """Align a whole extracted inspection against its style set."""
    sheet_rows = style.spoken_rows()
    rows: list[AlignedRow] = []
    sizes: list[str] = []

    announced = sheet.sizes()
    # An inspection of a single garment often never names the size — it just
    # reads the measurements straight through. The size set samples the base
    # size, so attribute them to it. Without this every reading is dropped for
    # want of a size, and the report comes out empty.
    unsized = not announced and bool(sheet.rows_in("measurement"))
    if unsized:
        if not style.base_size:
            log.warning("no size announced and style %s names no base size", style.style_no)
            return Alignment(style_no=style.style_no, sizes=(), rows=())
        log.info("no size announced; attributing measurements to base size %s", style.base_size)
        announced = [style.base_size]

    for size in announced:
        if size not in style.sizes:
            log.warning("size %s is not in style set %s", size, style.style_no)
        sizes.append(size)
        measured = sheet.rows_in("measurement") if unsized else sheet.rows_in("measurement", size)
        spoken = [
            (
                number,
                row.field,
                row.value,
                row.deviation,
                row.confidence,
                row.note,
                row.confirmed_okay,
                # getattr, not row.pom_index: `align` takes anything shaped like
                # an extraction, and the pin is only ever set by the audit view.
                getattr(row, "pom_index", -1),
            )
            for number, row in measured
        ]
        rows.extend(align_size(spoken, sheet_rows, size))

    alignment = Alignment(style_no=style.style_no, sizes=tuple(sizes), rows=tuple(rows))
    log.info(
        "aligned %d measurements to style %s: %d judged, %d out of tolerance, "
        "%d unmatched, %d verdict(s) not captured",
        len(alignment.rows),
        style.style_no,
        len(alignment.judged),
        len(alignment.failures),
        len(alignment.unmatched),
        len(alignment.unconfirmed),
    )
    if alignment.unconfirmed:
        log.warning(
            "%d point(s) of measure have no captured verdict and are reported "
            "unconfirmed, not on spec: %s",
            len(alignment.unconfirmed),
            ", ".join(f"{r.size} {r.pom or r.spoken}" for r in alignment.unconfirmed[:8]),
        )
    return alignment
