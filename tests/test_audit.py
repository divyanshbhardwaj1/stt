"""The audit view: reading the graded sheet as a grid, and settling cells in it.

The point of this screen is that a human can close the gaps the recording left.
So the tests that matter are the ones about provenance and placement: a
correction has to be recorded as a correction, and a reading entered against one
point of measure must never be filed under another.
"""

from dataclasses import replace
from fractions import Fraction

import pytest

from services.audit import (
    EMPTY,
    SettleError,
    audit_grid,
    regrade_size,
    settle,
    verify_placement,
)
from services.csv_filler import InspectionRow, InspectionSheet
from services.style_set import align, read_style_set

from .conftest import SHEET_PAYLOAD
from .style_set_fixture import write_style_set


@pytest.fixture
def style(tmp_path):
    path = tmp_path / "style_7270.pdf"
    write_style_set(path, style_no="7270")
    return read_style_set(path)


@pytest.fixture
def sheet():
    return InspectionSheet.from_payload(SHEET_PAYLOAD)


def _pom_rows(grid):
    return [row for row in grid["rows"] if row["kind"] == "pom"]


def test_the_grid_carries_every_row_the_sheet_prints(sheet, style):
    """Including the free-text lines, which the client's document owns."""
    grid = audit_grid(align(sheet, style), style, sheet)

    printed = {row["kind"] for row in grid["rows"]}
    assert printed == {"pom", "note"}, "free-text sheet lines must be reproduced, not dropped"
    assert len(grid["rows"]) == len(style.rows)
    assert grid["sizes"] == list(style.sizes)
    # Every point of measure gets a cell per size, whether or not it was spoken.
    for row in _pom_rows(grid):
        assert set(row["cells"]) == set(style.sizes)


def test_an_empty_cell_still_carries_the_spec(sheet, style):
    """An operator settling a cell has to know what the sheet expects of it."""
    grid = audit_grid(align(sheet, style), style, sheet)
    empty = [
        cell
        for row in _pom_rows(grid)
        if row["measured_here"]
        for cell in row["cells"].values()
        if cell["state"] == EMPTY
    ]
    assert empty, "this fixture is meant to leave some cells unspoken"
    assert any(cell["spec"] for cell in empty), "an empty cell with no spec teaches nothing"
    assert all(cell["row"] is None for cell in empty)


def test_correcting_a_cell_is_recorded_as_a_correction(sheet, style):
    """The report prints the corrected value plainly, so this trail is the only
    record that a human rather than the recording decided it."""
    alignment = align(sheet, style)
    target = next(
        row for row in _pom_rows(audit_grid(alignment, style, sheet)) if row["measured_here"]
    )
    size = next(s for s, cell in target["cells"].items() if cell["state"] != EMPTY)
    before = alignment.result_at(target["sheet_index"], size)

    settled = settle(
        sheet,
        alignment,
        style,
        [{"sheet_index": target["sheet_index"], "size": size, "deviation": "+1/4",
          "verdict": "deviation"}],
    )

    assert len(settled.corrections) == 1
    record = settled.corrections[0]
    assert record.sheet_index == target["sheet_index"]
    assert record.size == size
    assert record.created is False
    assert record.now_deviation == "+1/4"
    assert record.was_value == sheet.rows[before.number - 1].value
    # The extraction itself moved, which is what makes the re-render change.
    assert settled.rows[before.number - 1].deviation == "+1/4"
    assert len(settled.rows) == len(sheet.rows), "correcting must not add a row"


def test_a_settled_cell_is_marked_as_settled(sheet, style):
    """On screen, "who decided this" is a different question from "what is it"."""
    alignment = align(sheet, style)
    target = next(
        row for row in _pom_rows(audit_grid(alignment, style, sheet)) if row["measured_here"]
    )
    size = next(s for s, cell in target["cells"].items() if cell["state"] != EMPTY)

    settled = settle(
        sheet, alignment, style,
        [{"sheet_index": target["sheet_index"], "size": size, "verdict": "okay"}],
    )
    grid = audit_grid(align(settled, style), style, settled)
    cell = next(
        row["cells"][size] for row in _pom_rows(grid) if row["sheet_index"] == target["sheet_index"]
    )
    assert cell["edited"] is True


def test_filling_an_unspoken_cell_lands_on_that_point_of_measure(sheet, style):
    """The case the browser caught.

    A size nobody dictated has no earlier reading to advance the aligner's
    pointer, so wording alone cannot reach a point of measure further down the
    sheet - it came back unmatched. A hand-entered reading is pinned to the row
    it was entered against, because there is nothing to infer when a human has
    already said which one it is.
    """
    alignment = align(sheet, style)
    measured = {row.size for row in alignment.rows}
    quiet = next(size for size in style.sizes if size not in measured)
    # Deliberately far down the sheet, well past the aligner's forward window.
    far = [
        row["sheet_index"]
        for row in _pom_rows(audit_grid(alignment, style, sheet))
        if row["measured_here"]
    ][-1]

    settled = settle(
        sheet, alignment, style,
        [{"sheet_index": far, "size": quiet, "deviation": "-1/8", "verdict": "deviation"}],
    )
    realigned = align(settled, style)

    placed = realigned.result_at(far, quiet)
    assert placed is not None, "a settled cell must not come back unmatched"
    assert placed.sheet_index == far
    assert verify_placement(realigned, [(far, quiet)]) == []
    assert settled.corrections[-1].created is True
    assert settled.rows[-1].pom_index == far or any(
        row.pom_index == far for row in settled.rows
    )


def test_settling_does_not_touch_the_rest_of_the_sheet(sheet, style):
    """Everything else about the inspection has to survive an edit untouched."""
    alignment = align(sheet, style)
    target = next(
        row for row in _pom_rows(audit_grid(alignment, style, sheet)) if row["measured_here"]
    )
    size = next(s for s, cell in target["cells"].items() if cell["state"] != EMPTY)

    settled = settle(
        sheet, alignment, style,
        [{"sheet_index": target["sheet_index"], "size": size, "verdict": "okay"}],
    )
    assert settled.form == sheet.form
    assert settled.accessories == sheet.accessories
    assert settled.comments == sheet.comments


def test_an_extraction_saved_before_the_audit_view_still_loads():
    """Every report already on disk predates corrections and the pin."""
    old = InspectionSheet.from_payload(SHEET_PAYLOAD)
    assert old.corrections == ()
    assert all(row.pom_index == -1 for row in old.rows), "nothing is pinned until a human pins it"


def _first_reading(sheet, style):
    """A graded cell that actually carries a reading, with its coordinates."""
    alignment = align(sheet, style)
    grid = audit_grid(alignment, style, sheet)
    for row in _pom_rows(grid):
        if not row["measured_here"]:
            continue
        for size, cell in row["cells"].items():
            if cell["state"] != EMPTY and cell["spec"]:
                return alignment, row, size, cell
    raise AssertionError("fixture carries no graded reading")


def test_a_cell_separates_what_was_said_from_what_was_worked_out(sheet, style):
    """The measurement is rebuilt as spec + deviation, so it is not what anyone
    typed. The editor has to prefill from the extraction or it saves a computed
    number back over the inspector's own words."""
    _, _, _, cell = _first_reading(sheet, style)

    assert "stated" in cell
    assert set(cell["stated"]) == {"value", "deviation", "verdict", "note"}
    # The two are genuinely different fields, not aliases of one another.
    assert cell["stated"]["deviation"] != "ok", "'ok' is a rendering, never a stored deviation"


def test_editing_the_deviation_leaves_the_spoken_absolute_alone(sheet, style):
    """The bug: the editor prefilled Measured with the COMPUTED value and sent it
    back, so correcting a deviation quietly destroyed what the inspector said."""
    alignment, row, size, cell = _first_reading(sheet, style)
    spoken = cell["stated"]["value"]

    settled = settle(
        sheet, alignment, style,
        [{"sheet_index": row["sheet_index"], "size": size, "deviation": "-1/2"}],
    )
    changed = settled.rows[cell["row"] - 1]

    assert changed.deviation == "-1/2"
    assert changed.value == spoken, "correcting the deviation must not rewrite the absolute"


def test_the_measurement_cannot_be_typed_at_all(sheet, style):
    """The style sheet is the only source for a measurement.

    An editor box that accepted one was a second source for a number that must
    have exactly one, and it read as though the recording could supply it. Only
    the deviation, the verdict and the note come from the recording.
    """
    alignment, row, size, _ = _first_reading(sheet, style)

    with pytest.raises(SettleError, match="unknown field"):
        settle(
            sheet, alignment, style,
            [{"sheet_index": row["sheet_index"], "size": size, "measured": "12 5/8"}],
        )


def test_an_unreadable_entry_is_refused_rather_than_stored(sheet, style):
    """Stored verbatim it would come back "unconfirmed", which reads as though
    the operator never settled the cell they just settled."""
    alignment, row, size, _ = _first_reading(sheet, style)
    where = {"sheet_index": row["sheet_index"], "size": size}

    with pytest.raises(SettleError, match="not a deviation"):
        settle(sheet, alignment, style, [{**where, "deviation": "about a quarter"}])
    with pytest.raises(SettleError, match="unknown field"):
        settle(sheet, alignment, style, [{**where, "spec": "9 9/9"}])


def test_a_deviation_no_tape_measure_carries_is_refused(sheet, style):
    """Garment sheets are graded in binary fractions of an inch.

    "minus one by sixteen" mis-heard as "1/6" turned a 1 3/8 spec into a
    reported 1 5/24 - a number nobody can measure or act on. One such row was
    found in 7046 across the extractions on disk, so it reaches the report.
    """
    alignment, row, size, _ = _first_reading(sheet, style)
    where = {"sheet_index": row["sheet_index"], "size": size}

    with pytest.raises(SettleError, match="tape measure"):
        settle(sheet, alignment, style, [{**where, "deviation": "-1/6"}])
    # Sixteenths are real and must still go through.
    assert settle(sheet, alignment, style, [{**where, "deviation": "-1/16"}]).corrections


def test_an_edit_that_changes_nothing_is_not_recorded_as_a_correction(sheet, style):
    """An audit trail whose before and after match claims a decision nobody made."""
    alignment, row, size, _ = _first_reading(sheet, style)

    settled = settle(sheet, alignment, style, [{"sheet_index": row["sheet_index"], "size": size}])
    assert settled.corrections == ()
    assert settled.rows == sheet.rows


def test_the_recording_is_checked_against_itself(sheet, style):
    """Every reading is dictated twice - an absolute, then a deviation - and the
    absolute should agree with either the spec or the measurement. Agreeing with
    neither means the two spoken numbers cannot both be right."""
    from services.style_set.alignment import AlignedRow

    ok = AlignedRow(number=1, size="M", spoken="x", pom="1.01C", description="d",
                    spec=Fraction(4), measured=Fraction(4), deviation=Fraction(0),
                    in_tolerance=True, confidence=1.0, note="", heard=Fraction(4))
    assert not ok.disputed, "reading the spec aloud is the normal case"

    called = replace(ok, measured=Fraction(5), deviation=Fraction(1), heard=Fraction(5))
    assert not called.disputed, "calling the measurement aloud is also normal"

    # The case from style 2365: spec 4, "+1" heard, but the inspector said 3.
    contradiction = replace(ok, measured=Fraction(5), deviation=Fraction(1), heard=Fraction(3))
    assert contradiction.disputed


def _sheet_reading_column(style, size):
    """An extraction whose spoken absolutes are read straight off one column."""
    rows = []
    for pom in style.spoken_rows():
        spec = pom.specs.get(size)
        if spec is None:
            continue
        rows.append(
            InspectionRow(
                section="measurement",
                size=size,
                field=pom.description,
                value=str(spec),
                deviation="",
                note="",
                confidence=1.0,
                verdict="okay",
            )
        )
    return InspectionSheet(form={}, rows=tuple(rows))


def test_readings_filed_against_the_wrong_size_are_caught(style):
    """The most expensive thing this pipeline can get wrong.

    The recording usually does not announce a size, so `align` attributes
    everything to the sheet's base size. When the garment was a different size
    every row is judged against the wrong grade at once - and each row still
    looks individually plausible, which is why it needs checking rather than
    reading. Measured on a real inspection: 40 readings, all judged against S,
    all actually XXS.
    """
    from services.style_set.alignment import check_size_attribution

    graded = next(
        size
        for size in style.sizes
        if len({row.specs.get(size) for row in style.spoken_rows()}) > 1
    )
    honest = _sheet_reading_column(style, graded)
    found = check_size_attribution(align(honest, style), style)
    assert found and not any(f.disagrees for f in found), "read off its own column, it must agree"

    wrong = next(size for size in style.sizes if size != graded)
    moved = regrade_size(honest, graded, wrong, base_size=style.base_size)
    caught = check_size_attribution(align(moved, style), style)

    assert any(f.disagrees for f in caught), "readings filed under the wrong column must be caught"
    finding = next(f for f in caught if f.disagrees)
    assert finding.assigned == wrong
    assert finding.best == graded
    assert finding.votes[graded] > finding.votes.get(wrong, 0)


def test_regrading_moves_a_size_and_records_it(style):
    graded = next(
        size
        for size in style.sizes
        if len({row.specs.get(size) for row in style.spoken_rows()}) > 1
    )
    other = next(size for size in style.sizes if size != graded)
    original = _sheet_reading_column(style, graded)

    moved = regrade_size(original, graded, other, base_size=style.base_size)
    sizes = {row.size for row in moved.rows if row.section == "measurement"}
    assert sizes == {other}, "every reading of that size moves, and only that size"
    assert len(moved.rows) == len(original.rows), "regrading adds and drops nothing"
    assert moved.corrections[-1].was_verdict == graded
    assert moved.corrections[-1].now_verdict == other
    assert "regraded" in moved.corrections[-1].note
    # Sheet-level, so it never claims to be a correction to a real cell.
    assert moved.correction_for(0, other) is None

    with pytest.raises(SettleError, match="already filed"):
        regrade_size(original, graded, graded, base_size=style.base_size)


def test_no_measurement_on_the_graded_sheet_comes_from_the_recording(sheet, style):
    """The sheet is authoritative for the measurement; the recording supplies
    only the deviation. Measured across every graded job on disk: 5609 of 5611
    rows build from the spec, and the two that do not matched no point of
    measure at all - so they carry no spec and appear off the sheet entirely."""
    alignment = align(sheet, style)
    grid = audit_grid(alignment, style, sheet)

    for row in _pom_rows(grid):
        for size, cell in row["cells"].items():
            if cell["state"] == EMPTY:
                continue
            reading = alignment.result_at(row["sheet_index"], size)
            if reading.spec is None:
                continue
            # Exactly the spec plus the stated deviation, never the absolute.
            assert reading.measured == reading.spec + (reading.deviation or 0)

    placed = {r.number for r in alignment.rows if r.matched}
    for loose in grid["unmatched"]:
        assert loose["row"] not in placed, "an unplaced reading must not also sit on the sheet"


def test_a_cell_carries_its_spec_so_the_measurement_can_be_checked(sheet, style):
    """The measured column replaces the spec, so without this an auditor cannot
    see where the number came from without opening every cell."""
    _, _, _, cell = _first_reading(sheet, style)
    assert cell["spec"], "a graded cell has to show the spec it was built from"


def test_low_confidence_readings_are_flagged_on_the_grid(style):
    """6.4% of rows on disk are below the review threshold, and the audit view
    showed none of them: the operator could not tell a clean hearing from a
    guess."""
    from services.csv_filler.inspection_record import REVIEW_THRESHOLD

    graded = next(
        size for size in style.sizes
        if len({row.specs.get(size) for row in style.spoken_rows()}) > 1
    )
    rows = []
    for index, pom in enumerate(style.spoken_rows()):
        spec = pom.specs.get(graded)
        if spec is None:
            continue
        rows.append(
            InspectionRow(
                section="measurement", size=graded, field=pom.description,
                value=str(spec), deviation="", note="", verdict="okay",
                confidence=0.55 if index % 2 else 1.0,
            )
        )
    made = InspectionSheet(form={}, rows=tuple(rows))
    grid = audit_grid(align(made, style), style, made)

    flagged = [
        cell
        for row in _pom_rows(grid)
        for cell in row["cells"].values()
        if cell.get("low_confidence")
    ]
    # Anything short of certain is marked too, a step below the review
    # threshold: 87.4% of readings on disk come back at 1.00, so below-full is
    # a real signal rather than a mark on everything.
    assert all(cell.get("below_full") for cell in flagged), "under the threshold is also under 1.0"
    assert flagged, "rows heard at 0.55 must be marked"
    assert all(cell["confidence"] < REVIEW_THRESHOLD for cell in flagged)
    assert grid["low_confidence"] == len(flagged)
    assert grid["review_threshold"] == REVIEW_THRESHOLD
    # And a clean hearing is not flagged, or the mark means nothing.
    clean = [
        cell
        for row in _pom_rows(grid)
        for cell in row["cells"].values()
        if cell["state"] != EMPTY and not cell.get("low_confidence")
    ]
    assert clean and all(cell["confidence"] >= REVIEW_THRESHOLD for cell in clean)


def test_a_reading_short_of_certain_is_marked_even_above_the_threshold(style):
    """"Not quite sure" and "under the review threshold" are different claims.

    A row heard at 95% passes the report's own bar but is still not certain, and
    an auditor reading the sheet should be able to see that without opening it.
    """
    graded = next(
        size for size in style.sizes
        if len({row.specs.get(size) for row in style.spoken_rows()}) > 1
    )
    rows = []
    for index, pom in enumerate(style.spoken_rows()):
        spec = pom.specs.get(graded)
        if spec is None:
            continue
        rows.append(
            InspectionRow(
                section="measurement", size=graded, field=pom.description,
                value=str(spec), deviation="", note="", verdict="okay",
                confidence=0.95 if index % 2 else 1.0,
            )
        )
    made = InspectionSheet(form={}, rows=tuple(rows))
    grid = audit_grid(align(made, style), style, made)

    nearly = [
        cell for row in _pom_rows(grid) for cell in row["cells"].values()
        if cell.get("below_full")
    ]
    assert nearly, "0.95 is short of certain and must be marked"
    assert not any(cell.get("low_confidence") for cell in nearly), "but not as needing review"
    assert grid["below_full"] == len(nearly)
    assert grid["low_confidence"] == 0

    certain = [
        cell for row in _pom_rows(grid) for cell in row["cells"].values()
        if cell["state"] != EMPTY and not cell.get("below_full")
    ]
    assert certain and all(cell["confidence"] == 1.0 for cell in certain)
