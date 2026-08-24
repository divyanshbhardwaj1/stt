"""Matching spoken measurements to POM rows, and judging them against tolerance."""

from fractions import Fraction as F

import pytest

from services.csv_filler.graded_report import BLANK, MISSING_HEX
from services.measurements import format_measurement as fmt
from services.style_set import align_size, read_style_set
from services.style_set.spec_sheet import PomRow

from .style_set_fixture import write_style_set


def pom(code, description, minus="-1/4", plus="1/4", **specs):
    return PomRow(
        pom=code,
        description=description,
        tolerance_minus=F(minus) if isinstance(minus, str) else minus,
        tolerance_plus=F(plus) if isinstance(plus, str) else plus,
        specs={size: F(value) for size, value in specs.items()},
    )


def spoken(number, field, value, deviation="", confidence=1.0, note=""):
    return (number, field, value, deviation, confidence, note)


SHEET = [
    pom("1.20A", "ACROSS SHOULDER SEAM TO SEAM", M="27/2"),  # 13 1/2
    pom("1.22A", "ACROSS FRONT POSITION FROM HPS", minus=F(0), plus=F(0), M=F(5)),
    pom("1.23A", "ACROSS FRONT SEAM TO SEAM", M="93/8"),  # 11 5/8
    pom("1.25A", "ACROSS BACK SEAM TO SEAM", M=F(13)),
]


def test_rows_align_in_the_order_they_are_read():
    result = align_size(
        [
            spoken(1, "Across shoulder seam to seam", "13 1/2"),
            spoken(2, "Across front position from HPS", "5"),
            spoken(3, "Across front seam to seam", "11 5/8"),
            spoken(4, "Across back seam to seam", "13"),
        ],
        SHEET,
        "M",
    )

    assert [row.pom for row in result] == ["1.20A", "1.22A", "1.23A", "1.25A"]
    assert all(row.matched for row in result)


def test_wording_outranks_a_value_that_fits_a_neighbour():
    """The bug that hid a real defect.

    "Across shoulder seam to seam" measured 13 is out of tolerance against its
    own row (spec 13 1/2) but exactly equals the later "across back" row. Letting
    the value decide would move the reading onto the wrong POM and report a pass.
    """
    result = align_size([spoken(1, "Across shoulder seam to seam", "13")], SHEET, "M")

    assert result[0].pom == "1.20A"
    assert result[0].in_tolerance is False
    assert fmt(result[0].deviation, signed=True) == "-1/2"


def test_value_still_separates_rows_that_read_alike():
    """Wording alone cannot split "across front" from "across back"."""
    result = align_size([spoken(1, "Across seam to seam", "13")], SHEET, "M")

    assert result[0].pom == "1.25A"


def test_position_rows_keep_the_sequence_in_step():
    """They carry no tolerance but are read aloud; skipping them shifts everything."""
    result = align_size(
        [
            spoken(1, "Across front position from HPS", "5"),
            spoken(2, "Across front seam to seam", "11 5/8"),
        ],
        SHEET,
        "M",
    )

    assert [row.pom for row in result] == ["1.22A", "1.23A"]
    assert result[0].in_tolerance is None  # no tolerance band, so no verdict
    assert result[1].in_tolerance is True


def test_a_deviation_alone_pins_the_measurement():
    """An inspector who calls only "+1/8" has still fixed the value."""
    result = align_size([spoken(1, "Across back seam to seam", "", deviation="+1/8")], SHEET, "M")

    assert fmt(result[0].measured) == "13 1/8"
    assert result[0].in_tolerance is True


def test_a_reading_outside_the_band_fails():
    result = align_size([spoken(1, "Across back seam to seam", "13 1/2")], SHEET, "M")

    assert result[0].is_fail
    assert fmt(result[0].deviation, signed=True) == "+1/2"


def test_a_reading_on_the_boundary_passes():
    result = align_size([spoken(1, "Across back seam to seam", "13 1/4")], SHEET, "M")

    assert result[0].in_tolerance is True


def test_something_unrecognisable_is_left_unmatched():
    """Better an explicit gap than a confident match to the wrong POM."""
    result = align_size([spoken(1, "Zipper pull colour", "7")], SHEET, "M")

    assert not result[0].matched
    assert result[0].in_tolerance is None
    assert result[0].pom == ""


def test_the_pointer_does_not_run_backwards():
    """Two readings can never claim the same sheet row."""
    result = align_size(
        [
            spoken(1, "Across front seam to seam", "11 5/8"),
            spoken(2, "Across front seam to seam", "11 5/8"),
        ],
        SHEET,
        "M",
    )

    assert result[0].pom == "1.23A"
    assert result[1].pom != "1.23A"


def test_repeated_pom_codes_are_told_apart_by_position():
    """A style with a lining repeats 1.01C, so the code alone is not an identity."""
    sheet = [
        pom("1.01C", "DRESS LENGTH FROM HPS", minus="-1/2", plus="1/2", M="69/2"),
        pom("1.01C", "LINING - DRESS LENGTH FROM HPS", minus="-1/2", plus="1/2", M="67/2"),
    ]

    result = align_size(
        [
            spoken(1, "Dress length from HPS", "34 1/2"),
            spoken(2, "Lining dress length from HPS", "33 1/2"),
        ],
        sheet,
        "M",
    )

    assert [row.sheet_index for row in result] == [0, 1]
    assert [fmt(row.spec) for row in result] == ["34 1/2", "33 1/2"]
    assert all(row.in_tolerance for row in result)


@pytest.mark.real_style_sets
def test_a_grade_rule_suffix_does_not_drop_the_row(tmp_path):
    """ "7.09B GR" must parse, or belt lengths land on the belt-width row."""
    from .conftest import REAL_STYLE_SETS

    path = REAL_STYLE_SETS / "style_9662_clean.pdf"
    if not path.is_file():
        pytest.skip(f"{path.name} not present")

    codes = [row.pom for row in read_style_set(path).rows]

    assert "7.09B GR" in codes
    assert "7.02C GR" in codes


def test_an_unmeasured_size_falls_back_to_the_spec_but_is_labelled():
    """Filling the column keeps it readable; the label stops it reading as a measurement."""
    from services.csv_filler.graded_report import _cell_text

    row = pom("1.20A", "ACROSS SHOULDER SEAM TO SEAM", M="27/2", XS=F(12))

    text = _cell_text(None, row, "XS")

    assert "12" in text
    assert "spec" in text
    assert MISSING_HEX in text  # grey, never the ink used for a real reading


def test_a_size_the_sheet_does_not_grade_stays_blank():
    from services.csv_filler.graded_report import _cell_text

    row = pom("1.20A", "ACROSS SHOULDER SEAM TO SEAM", M="27/2", XS=F(0))

    assert _cell_text(None, row, "XS").endswith(f">{BLANK}</font>")


def test_alignment_reports_a_verdict_over_the_whole_run(tmp_path):
    style = read_style_set(write_style_set(tmp_path / "style_9999.pdf"))
    rows = align_size(
        [spoken(1, "Front length from HPS - NK seam", "32 3/4")], style.spoken_rows(), "M"
    )

    assert rows[0].pom == "1.01C"
    assert rows[0].in_tolerance is True
