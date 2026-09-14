"""The graded sheet as something a person can read and settle, cell by cell.

The graded PDF already lays the inspection out the way the client's document
does: every point of measure the sheet prints, down the page, with one column
per size. This builds that same grid as data, so the browser can render it and
let an operator click into a cell.

Two jobs, kept apart on purpose:

`audit_grid` is a pure read. It joins the spec sheet (authoritative for the POM,
its description and its tolerance band) to the alignment (what the recording
actually produced for each cell), and says nothing that is not already in one
of the two.

`settle` is the write. It applies an operator's corrections to the extraction -
the JSON that everything else is rendered from - and records what changed. The
report itself renders the corrected value plainly; this trail is the only place
that remembers a human, rather than the recording, decided it.


Lives above both packages rather than inside either: it needs the spec sheet and
the extraction together, and `csv_filler` already depends on `style_set`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from services.csv_filler import Correction, InspectionRow, InspectionSheet
from services.csv_filler.inspection_record import REVIEW_THRESHOLD
from services.measurements import format_measurement as fmt
from services.measurements import is_garment_fraction, parse

from services.style_set import AlignedRow, Alignment
from services.style_set.alignment import check_size_attribution
from services.style_set.spec_sheet import StyleSet

log = logging.getLogger(__name__)

# Cell states, in the order the product ranks them: a gap outranks a finding.
EMPTY = "empty"
UNCONFIRMED = "unconfirmed"
FAIL = "fail"
UNJUDGED = "unjudged"
PASS = "pass"

EDITABLE = ("value", "deviation", "verdict", "note")
# What the editor may send. There is deliberately no measurement here: the style
# sheet is the only source for that, and a second way in would be a second
# source for a number that must have exactly one.
ACCEPTED = (*EDITABLE, "audit_note", "sheet_index", "size")


def _measure(value, signed: bool = False) -> str:
    return "" if value is None else fmt(value, signed=signed)


def _state(row: AlignedRow | None) -> str:
    if row is None:
        return EMPTY
    if row.unconfirmed:
        return UNCONFIRMED
    if row.is_fail:
        return FAIL
    if row.in_tolerance is None:
        return UNJUDGED
    return PASS


def _cell(
    result: AlignedRow | None, spec: str, edited: bool, stated: InspectionRow | None
) -> dict[str, object]:
    """One size column of one point of measure.

    `measured` and `deviation` are what the sheet WORKS OUT: the measurement is
    rebuilt as spec + deviation, so neither is a field anyone typed. `stated` is
    the extraction underneath - what the inspector was heard to say - and it is
    what the editor has to prefill from. Prefilling from the computed pair and
    writing it back is how the spoken absolute gets overwritten by a number
    nobody said.
    """
    if result is None:
        # The spec still belongs here. An operator settling this cell needs to
        # know what the sheet expects before they can say what they heard.
        return {"row": None, "spec": spec, "state": EMPTY}
    return {
        "row": result.number,
        "spec": spec,
        "measured": _measure(result.measured),
        "deviation": "ok" if result.on_spec else _measure(result.deviation, signed=True),
        "heard": _measure(result.heard),
        "spoken": result.spoken,
        "note": result.note,
        "confidence": round(result.confidence, 2),
        "state": _state(result),
        # Two levels, because they answer different questions. Anything short of
        # certain is worth an eye - 87.4% of readings across the extractions on
        # disk come back at 1.00, so below that is a real signal rather than
        # noise. Below REVIEW_THRESHOLD is the stronger claim the report's own
        # "worth confirming" section is built on, and is emphasised harder.
        "below_full": result.confidence < 1.0,
        "low_confidence": result.confidence < REVIEW_THRESHOLD,
        # The recording contradicted itself here: the absolute the inspector
        # read aloud matches neither the sheet nor the measurement built from
        # it. Not a verdict - the report still uses spec + deviation - but the
        # operator has to be able to see it and listen back.
        "disputed": result.disputed,
        "edited": edited,
        "stated": {
            "value": stated.value if stated else "",
            "deviation": stated.deviation if stated else "",
            "verdict": stated.verdict if stated else "",
            "note": stated.note if stated else "",
        },
    }


def _stated(sheet: InspectionSheet, result: AlignedRow | None) -> InspectionRow | None:
    """The extraction row behind a reading, by its report number."""
    if result is None:
        return None
    index = result.number - 1
    return sheet.rows[index] if 0 <= index < len(sheet.rows) else None


def audit_grid(alignment: Alignment, style: StyleSet, sheet: InspectionSheet) -> dict[str, object]:
    """The whole graded sheet, one entry per printed row, for the browser.

    Mirrors `save_graded_pdf` exactly - same rows, same order, same per-size
    cells - so the screen and the paper cannot drift apart.
    """
    # Keyed on sheet position, not report number: inserting a settled row
    # renumbers everything after it.
    edited_cells = {(c.sheet_index, c.size) for c in sheet.corrections}
    sizes = list(style.sizes)
    rows: list[dict[str, object]] = []

    for pom_row, sheet_index in style.rows_in_sheet_order():
        if sheet_index is None:
            # A free-text line off the client's sheet. Reproduced because the
            # sheet is the authority on its own contents, but nothing to settle.
            rows.append({"kind": "note", "pom": pom_row.pom, "description": pom_row.description})
            continue
        results = {size: alignment.result_at(sheet_index, size) for size in sizes}
        rows.append(
            {
                "kind": "pom",
                "sheet_index": sheet_index,
                "pom": pom_row.pom,
                "description": pom_row.description,
                "tol_minus": _measure(pom_row.tolerance_minus, signed=True),
                "tol_plus": _measure(pom_row.tolerance_plus, signed=True),
                "measured_here": pom_row.is_measured,
                "cells": {
                    size: _cell(
                        results[size],
                        _measure(pom_row.specs.get(size)),
                        (sheet_index, size) in edited_cells,
                        _stated(sheet, results[size]),
                    )
                    for size in sizes
                },
            }
        )

    return {
        "style_no": alignment.style_no,
        "sizes": sizes,
        "base_size": style.base_size,
        "measured_sizes": sorted(set(alignment.sizes)),
        "verdict": alignment.verdict,
        "disputed": len(alignment.disputed),
        "low_confidence": sum(
            1 for row in alignment.rows if row.matched and row.confidence < REVIEW_THRESHOLD
        ),
        "below_full": sum(1 for row in alignment.rows if row.matched and row.confidence < 1.0),
        "review_threshold": REVIEW_THRESHOLD,
        # Which size column the recording's own absolutes actually fit. A sheet
        # graded against the wrong column is wrong in every row at once and
        # looks entirely plausible, so this is surfaced whether or not it
        # disagrees - "checked, and it fits" is worth saying too.
        "size_check": [
            {
                "assigned": evidence.assigned,
                "best": evidence.best,
                "disagrees": evidence.disagrees,
                "votes": {size: count for size, count in evidence.votes.items() if count},
            }
            for evidence in check_size_attribution(alignment, style)
        ],
        "rows": rows,
        # Readings the aligner could not place. Invisible on the printed sheet -
        # there is no row to print them on - but an operator settling the
        # inspection has to be able to see that they exist.
        "unmatched": [
            {
                "row": row.number,
                "size": row.size,
                "spoken": row.spoken,
                "measured": _measure(row.measured),
                "deviation": _measure(row.deviation, signed=True),
            }
            for row in alignment.unmatched
        ],
        "corrections": [
            {
                "sheet_index": c.sheet_index,
                "row": c.row,
                "at": c.at,
                "pom": c.pom,
                "size": c.size,
                "was": {
                    "value": c.was_value,
                    "deviation": c.was_deviation,
                    "verdict": c.was_verdict,
                },
                "now": {
                    "value": c.now_value,
                    "deviation": c.now_deviation,
                    "verdict": c.now_verdict,
                },
                "created": c.created,
            }
            for c in sheet.corrections
        ],
    }


class SettleError(ValueError):
    """An edit that cannot be applied, named well enough to act on."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _replace(row: InspectionRow, edit: dict[str, str]) -> InspectionRow:
    from dataclasses import replace

    return replace(row, **{key: edit[key] for key in EDITABLE if key in edit})


def _checked(edit: dict[str, object]) -> dict[str, object]:
    """Refuse an edit that cannot be read, rather than storing it as nonsense.

    An unparseable deviation would otherwise be stored verbatim and come back
    as "unconfirmed" - which is safe, but reads as though the operator never
    settled the cell they just settled.
    """
    stray = set(edit) - set(ACCEPTED)
    if stray:
        raise SettleError(f"unknown field(s) in an edit: {', '.join(sorted(stray))}")
    deviation = str(edit.get("deviation", "")).strip()
    if deviation:
        parsed = parse(deviation)
        if parsed is None:
            raise SettleError(
                f"{deviation!r} is not a deviation. Write it signed, like '-1/8' or "
                "'+1/4', or leave it empty and set the verdict to okay."
            )
        if not is_garment_fraction(parsed):
            raise SettleError(
                f"{deviation!r} is not a fraction of an inch a tape measure carries. "
                "Use halves, quarters, eighths or sixteenths."
            )
    return edit


def settle(
    sheet: InspectionSheet,
    alignment: Alignment,
    style: StyleSet,
    edits: list[dict[str, object]],
) -> InspectionSheet:
    """Apply an operator's corrections to the extraction.

    Each edit names a cell by `sheet_index` and `size` - the same coordinates the
    grid is drawn on - plus whichever of value/deviation/verdict/note changed.
    A cell the recording never produced is created rather than refused: those are
    exactly the points of measure that block a report today, and settling them
    against the audio is the job this screen exists for.

    Returns a new sheet. Rendering it is the caller's business, because that is
    also what recomputes the alignment and so the verdict.
    """
    rows = list(sheet.rows)
    corrections = list(sheet.corrections)
    order = {index: pom for index, pom in enumerate(style.spoken_rows())}

    for raw in edits:
        sheet_index = int(raw["sheet_index"])  # type: ignore[arg-type]
        size = str(raw["size"])
        if sheet_index not in order:
            raise SettleError(
                f"no point of measure at position {sheet_index} on style {style.style_no}"
            )
        pom_row = order[sheet_index]
        edit = _checked(raw)
        if not any(key in edit for key in EDITABLE):
            # Nothing to change. Recording it anyway would put a correction in
            # the trail whose before and after are identical, which reads as a
            # human decision that never happened.
            continue
        existing = alignment.result_at(sheet_index, size)

        if existing is not None:
            index = existing.number - 1
            if not 0 <= index < len(rows):
                raise SettleError(f"row {existing.number} is not in the extraction any more")
            before = rows[index]
            rows[index] = _replace(before, edit)  # type: ignore[arg-type]
            after = rows[index]
            corrections.append(
                Correction(
                    sheet_index=sheet_index,
                    row=existing.number,
                    at=_now(),
                    pom=pom_row.pom,
                    size=size,
                    was_value=before.value,
                    was_deviation=before.deviation,
                    was_verdict=before.verdict,
                    now_value=after.value,
                    now_deviation=after.deviation,
                    now_verdict=after.verdict,
                    note=str(edit.get("audit_note", "")),
                )
            )
            continue

        # Nothing was heard for this cell. Build the row the recording never
        # produced, and put it where the dictation would have had it: the
        # aligner walks the sheet in order with a short lookahead, so a row
        # appended to the end would not be looked at when its POM comes round.
        fresh = InspectionRow(
            section="measurement",
            size=size,
            # The sheet's own wording. The pin below is what actually places
            # the row; this keeps the reading readable in the CSV and the trail.
            field=pom_row.description,
            value=str(edit.get("value", "")),
            deviation=str(edit.get("deviation", "")),
            note=str(edit.get("note", "")),
            confidence=1.0,
            verdict=str(edit.get("verdict", "")),
            # Pinned, so the aligner files it against this point of measure and
            # no other. Wording alone cannot reach the first reading on a size
            # nobody dictated: there is no earlier row to advance the pointer,
            # so anything past the forward window would come back unmatched.
            pom_index=sheet_index,
        )
        at = _insertion_point(rows, alignment, size, sheet_index)
        rows.insert(at, fresh)
        corrections.append(
            Correction(
                sheet_index=sheet_index,
                row=at + 1,
                at=_now(),
                pom=pom_row.pom,
                size=size,
                was_value="",
                was_deviation="",
                was_verdict="",
                now_value=fresh.value,
                now_deviation=fresh.deviation,
                now_verdict=fresh.verdict,
                created=True,
                note=str(edit.get("audit_note", "")),
            )
        )
        # Numbers shift for every row after the insertion, and the alignment in
        # hand is now stale. One insertion per call keeps that honest.
        alignment = _renumber(alignment, at + 1)

    return InspectionSheet(
        form=dict(sheet.form),
        accessories=sheet.accessories,
        comments=sheet.comments,
        rows=tuple(rows),
        corrections=tuple(corrections),
    )


def _insertion_point(
    rows: list[InspectionRow], alignment: Alignment, size: str, sheet_index: int
) -> int:
    """Where a newly settled reading belongs in the dictation order.

    Immediately after the last reading of the same size that sits earlier on the
    sheet. That puts the new row inside the aligner's forward window when it
    reaches this point of measure; appending to the end would not.
    """
    before = [
        row.number
        for row in alignment.rows
        if row.size == size and row.matched and row.sheet_index < sheet_index
    ]
    if before:
        return max(before)  # number is 1-based, so this index is "just after it"
    same_size = [row.number for row in alignment.rows if row.size == size]
    return min(same_size) - 1 if same_size else len(rows)


def _renumber(alignment: Alignment, inserted_at: int) -> Alignment:
    """Shift row numbers past an insertion, so later edits in the same call land."""
    from dataclasses import replace

    return replace(
        alignment,
        rows=tuple(
            replace(row, number=row.number + 1) if row.number >= inserted_at else row
            for row in alignment.rows
        ),
    )


# A size change is not a cell edit, so it has no sheet position. -1 keeps it in
# the same trail without ever matching a real cell in `correction_for`.
SHEET_LEVEL = -1


def regrade_size(
    sheet: InspectionSheet, from_size: str, to_size: str, base_size: str = ""
) -> InspectionSheet:
    """Re-file a whole size's readings against a different column of the sheet.

    The recording usually does not announce a size, and `align` then attributes
    everything to the sheet's base size. When the garment on the table was not
    the base size, every reading is judged against the wrong grade at once -
    which is both the worst thing this pipeline can get wrong and the hardest to
    see, because each row looks individually reasonable.

    Rows carrying no size at all are the ones that fell through to the base size,
    so they move too when that is what is being corrected.
    """
    if not to_size:
        raise SettleError("no size to regrade to")
    if from_size == to_size:
        raise SettleError(f"the readings are already filed as {to_size}")

    from dataclasses import replace

    moved = 0
    rows = []
    for row in sheet.rows:
        unsized = not row.size and from_size == base_size
        if row.section == "measurement" and (row.size == from_size or unsized):
            rows.append(replace(row, size=to_size))
            moved += 1
        else:
            rows.append(row)

    if not moved:
        raise SettleError(f"no measurements are filed as {from_size}")

    return InspectionSheet(
        form=dict(sheet.form),
        accessories=sheet.accessories,
        comments=sheet.comments,
        rows=tuple(rows),
        corrections=(
            *sheet.corrections,
            Correction(
                sheet_index=SHEET_LEVEL,
                size=to_size,
                at=_now(),
                pom="",
                row=0,
                was_value="",
                was_deviation="",
                was_verdict=from_size,
                now_value="",
                now_deviation="",
                now_verdict=to_size,
                note=f"{moved} readings regraded from {from_size} to {to_size}",
            ),
        ),
    )


def verify_placement(
    alignment: Alignment, expected: list[tuple[int, str]]
) -> list[tuple[int, str]]:
    """Cells that were settled but did not come back on the point of measure meant.

    The aligner is fuzzy by necessity, and a hand-entered reading landing on the
    wrong row would be a silent corruption of the sheet. Cheaper to check than
    to trust: this is called after the re-render and anything it returns is
    reported rather than swallowed.
    """
    return [
        (sheet_index, size)
        for sheet_index, size in expected
        if alignment.result_at(sheet_index, size) is None
    ]
