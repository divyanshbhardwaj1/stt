"""Reading Triburg style sets, and choosing the right one for a recording."""

from fractions import Fraction as F

import pytest

from services.measurements import check_tolerance, format_measurement
from services.style_set import (
    SpecSheetError,
    StyleSetNotFound,
    find_style_set,
    read_style_set,
    style_set_files,
)

from .conftest import REAL_STYLE_SETS
from .style_set_fixture import (
    EXPECTED_BASE_SIZE_SPECS,
    MEASURED_POMS,
    SIZES,
    write_cell_layout_style_set,
    write_scanned_style_set,
    write_style_set,
)

# Triburg emit both layouts, so every reading test runs against both.
LAYOUTS = {"row-per-line": write_style_set, "cell-per-line": write_cell_layout_style_set}


@pytest.fixture(params=LAYOUTS.values(), ids=LAYOUTS.keys())
def style_set(request, tmp_path):
    return read_style_set(request.param(tmp_path / "style_9999.pdf"))


# --- reading the sheet -------------------------------------------------------


def test_header_fields_are_read(style_set):
    assert style_set.style_no == "9999"
    assert style_set.description == "9999 TEST GARMENT"
    assert style_set.season == "SS 2026"
    assert style_set.division == "01 / 001"
    assert style_set.base_size == "M"
    assert style_set.status == "FNL"


def test_sizes_come_from_the_column_header(style_set):
    """The size range differs per style, so it is read rather than assumed."""
    assert style_set.sizes == SIZES


def test_every_row_is_parsed(style_set):
    assert [row.pom for row in style_set.rows] == [
        "*",
        "0.00A",
        "1.01C",
        "2.01A",
        "1.20A",
        "1.28A",
        "1.30A",
    ]


def test_notes_and_zero_tolerance_rows_are_not_measured(style_set):
    """'*' notes and reference rows carry no tolerance, so nothing is checked."""
    assert [row.pom for row in style_set.measured_rows()] == list(MEASURED_POMS)


def test_both_layouts_describe_the_same_sheet(tmp_path):
    """The layout is Triburg's choice; it must not change a single value."""
    by_row = read_style_set(write_style_set(tmp_path / "row.pdf"))
    by_cell = read_style_set(write_cell_layout_style_set(tmp_path / "cell.pdf"))

    assert by_row.sizes == by_cell.sizes
    assert by_row.style_no == by_cell.style_no == "9999"
    assert by_row.base_size == by_cell.base_size == "M"
    assert [(r.pom, r.description, r.specs) for r in by_row.rows] == [
        (r.pom, r.description, r.specs) for r in by_cell.rows
    ]


@pytest.mark.parametrize(("pom", "expected"), EXPECTED_BASE_SIZE_SPECS.items())
def test_base_size_specs(style_set, pom, expected):
    row = style_set.find(pom)

    assert format_measurement(row.spec_for("M")) == expected


def test_a_wrapped_description_keeps_its_numbers(style_set):
    """1.20A's description runs onto a second line and its values onto a third."""
    row = style_set.find("1.20A")

    assert row.description == "ACROSS SHOULDER SEAM TO SEAM ** TOL UPDATED"
    assert format_measurement(row.spec_for("XXS")) == "12 1/4"
    assert format_measurement(row.spec_for("XXL")) == "16"


def test_spaced_fractions_are_not_split_into_two_columns(style_set):
    """'16 1/2' is one value; a naive token split would make it two."""
    row = style_set.find("1.30A")

    assert [format_measurement(row.spec_for(s)) for s in ("L", "XL", "XXL")] == [
        "16 1/2",
        "18",
        "20",
    ]


def test_a_row_on_a_page_break_keeps_its_own_values(style_set):
    """The repeated page header lands on the end of that row during extraction.

    Left in, the row reads "Incremental / IN" as measurements and every size for
    it comes out blank — which is what style 7147's 2.05B did.
    """
    row = style_set.find("2.01A")

    assert row.description == "SHOULDER SEAM FORWARD"
    assert "STATUS" not in row.description
    assert [format_measurement(row.spec_for(size)) for size in SIZES] == ["1/2"] * 7


def test_tolerances_are_signed(style_set):
    row = style_set.find("1.01C")

    assert row.tolerance_minus == F(-5, 8)
    assert row.tolerance_plus == F(5, 8)


def test_a_scanned_sheet_is_rejected_with_an_actionable_message(tmp_path):
    """A scan silently half-parsed would validate against missing numbers."""
    scanned = write_scanned_style_set(tmp_path / "style_1234.pdf")

    with pytest.raises(SpecSheetError, match="no text layer"):
        read_style_set(scanned)


def test_a_missing_file_is_rejected(tmp_path):
    with pytest.raises(SpecSheetError, match="not found"):
        read_style_set(tmp_path / "absent.pdf")


def test_a_pdf_without_the_column_header_is_rejected(tmp_path):
    other = write_style_set(tmp_path / "style_1.pdf", lines=["SOME OTHER DOCUMENT", "hello"])

    with pytest.raises(SpecSheetError, match="no 'POM Description Tol- Tol\\+ ...' header"):
        read_style_set(other)


# --- the spec sheet is what makes a verdict possible -------------------------


def test_a_measured_value_can_be_checked_against_its_tolerance(style_set):
    """This is the whole point: spec + tolerance turns a reading into pass/fail."""
    row = style_set.find("1.28A")
    spec = row.spec_for("M")  # 16 1/4, tolerance -3/8..+3/8

    within, ok = check_tolerance(spec, spec + F(1, 4), row.tolerance_minus, row.tolerance_plus)
    beyond, bad = check_tolerance(spec, spec + F(1, 2), row.tolerance_minus, row.tolerance_plus)

    assert (format_measurement(within, signed=True), ok) == ("+1/4", True)
    assert (format_measurement(beyond, signed=True), bad) == ("+1/2", False)


# --- choosing the sheet ------------------------------------------------------


def test_the_style_number_selects_the_sheet(tmp_path):
    write_style_set(tmp_path / "style_9999.pdf")

    assert find_style_set("9999", tmp_path).style_no == "9999"


def test_an_unknown_style_lists_what_is_available(tmp_path):
    write_style_set(tmp_path / "style_9999.pdf")

    with pytest.raises(StyleSetNotFound, match="style_9999"):
        find_style_set("1234", tmp_path)


def test_a_blank_style_number_is_reported_plainly(tmp_path):
    with pytest.raises(StyleSetNotFound, match="did not announce a style number"):
        find_style_set("", tmp_path)


def test_an_empty_directory_is_reported(tmp_path):
    with pytest.raises(StyleSetNotFound, match="no style set PDFs"):
        find_style_set("9999", tmp_path)


def test_a_filename_that_lies_about_its_style_is_refused(tmp_path):
    """Validating against the wrong sheet would be worse than failing."""
    write_style_set(tmp_path / "style_1234.pdf")  # contains STYLE: 9999

    with pytest.raises(StyleSetNotFound, match="contains style 9999"):
        find_style_set("1234", tmp_path)


def test_style_set_files_ignores_other_documents(tmp_path):
    write_style_set(tmp_path / "style_9999.pdf")
    (tmp_path / "notes.txt").write_text("x")

    assert [p.name for p in style_set_files(tmp_path)] == ["style_9999.pdf"]


def test_style_set_files_tolerates_a_missing_directory(tmp_path):
    assert style_set_files(tmp_path / "absent") == []


# --- the genuine client sheets ----------------------------------------------


@pytest.mark.real_style_sets
def test_the_real_style_sets_parse():
    """The stand-in could drift; this checks Triburg's actual exports still read."""
    parsed = {}
    for path in style_set_files(REAL_STYLE_SETS):
        try:
            style = read_style_set(path)
        except SpecSheetError:
            continue  # scanned sheets are covered by their own test
        parsed[style.style_no] = style

    assert "9685" in parsed, "expected style 9685 to parse"
    sheet = parsed["9685"]
    assert sheet.description == "9685 STRIPE POLO MINI DRESS"
    assert sheet.sizes == SIZES
    assert format_measurement(sheet.find("1.01C").spec_for("M")) == "32 3/4"
    assert format_measurement(sheet.find("1.28A").spec_for("M")) == "16 1/4"
    assert sheet.find("1.28A").tolerance_plus == F(3, 8)


@pytest.mark.real_style_sets
def test_the_cell_layout_export_parses():
    """style_9662_clean.pdf arrived in the one-line-per-cell layout."""
    path = REAL_STYLE_SETS / "style_9662_clean.pdf"
    if not path.is_file():
        pytest.skip(f"{path.name} not present")

    sheet = read_style_set(path)

    assert sheet.style_no == "9662"
    assert sheet.description == "9662 OCCASION SHORT SLV MINI"
    assert sheet.base_size == "M"
    assert sheet.sizes == SIZES
    # Values the recording's extraction was cross-checked against.
    assert format_measurement(sheet.find("1.23A").spec_for("M")) == "11 5/8"
    assert format_measurement(sheet.find("3.02B").spec_for("M")) == "5 5/8"
    assert format_measurement(sheet.find("2.03A").spec_for("M")) == "10 1/8"
