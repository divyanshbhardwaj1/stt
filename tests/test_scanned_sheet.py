"""Reading a style set that arrived as a scan instead of an export.

Two of the eight sheets on hand carry no text layer. Reading them is a last
resort and is built to be checked: a misread spec is wrong in every row at once,
because every measurement on the report is rebuilt as spec + deviation.
"""

import json
from fractions import Fraction as F

import pytest

from services.style_set import SpecSheetError, StyleSetNotFound, find_style_set, read_style_set
from services.style_set.scanned import cache_path_for, parsed_rows, suspect_rows
from services.style_set.spec_sheet import PomRow

from .style_set_fixture import write_scanned_style_set, write_style_set

SIZES = ("XXS", "XS", "S", "M")


class FakeVision:
    """Stands in for the model, and counts how often it is asked."""

    def __init__(self, payload):
        self.payload = payload
        self.calls = 0
        outer = self

        class Responses:
            def create(self, **kwargs):
                outer.calls += 1
                return type("R", (), {"output_text": json.dumps(outer.payload)})()

        self.responses = Responses()


def _payload(rows=None):
    return {
        "style_no": "1234",
        "base_size": "S",
        "sizes": list(SIZES),
        "rows": rows
        if rows is not None
        else [
            {"pom": "*", "description": "A NOTE OFF THE SHEET", "tol_minus": "", "tol_plus": "",
             "values": ["", "", "", ""]},
            {"pom": "1.01C", "description": "FRONT LENGTH", "tol_minus": "-3/8", "tol_plus": "3/8",
             "values": ["26", "26 1/2", "27", "27 1/2"]},
            {"pom": "4.05A", "description": "WAISTBAND HEIGHT", "tol_minus": "-1/8",
             "tol_plus": "1/8", "values": ["1 1/4", "1 1/4", "1 1/4", "1 1/4"]},
        ],
    }


@pytest.fixture
def scanned(tmp_path):
    return write_scanned_style_set(tmp_path / "style_1234.pdf")


def test_without_a_model_a_scan_is_still_refused(scanned):
    """The refusal is correct behaviour, not a gap. Reading an image is opt-in."""
    with pytest.raises(SpecSheetError, match="no text layer"):
        read_style_set(scanned)


def test_a_scan_can_be_read_and_is_marked_as_read(scanned, settings, monkeypatch):
    vision = FakeVision(_payload())
    monkeypatch.setattr("openai.OpenAI", lambda api_key: vision)

    style = read_style_set(scanned, settings)

    assert style.from_scan is True, "a sheet read from an image must say so"
    assert style.style_no == "1234"
    assert style.base_size == "S"
    assert style.sizes == SIZES
    assert len(style.rows) == 3, "free-text rows are kept, so the sheet keeps its order"
    measured = style.measured_rows()
    assert len(measured) == 2
    assert measured[0].specs["S"] == F(27)
    assert measured[0].tolerance_plus == F(3, 8)


def test_the_reading_is_cached_and_never_paid_for_twice(scanned, settings, monkeypatch):
    """Vision output is not deterministic. Two reads of one scan would otherwise
    be two different sheets, and the same style could grade differently on two
    machines."""
    vision = FakeVision(_payload())
    monkeypatch.setattr("openai.OpenAI", lambda api_key: vision)

    first = read_style_set(scanned, settings)
    assert vision.calls == 1
    assert cache_path_for(scanned).is_file()

    second = read_style_set(scanned, settings)
    assert vision.calls == 1, "the second read must come from the cache"
    assert second.rows == first.rows


def test_a_text_layer_always_beats_a_scan(tmp_path, settings, monkeypatch):
    """Style 9662 ships as a scan with a clean re-export beside it. Reading the
    image when an exact sheet is available would trade precision for nothing."""
    write_scanned_style_set(tmp_path / "style_9999.pdf")
    write_style_set(tmp_path / "style_9999_clean.pdf", style_no="9999")
    vision = FakeVision(_payload())
    monkeypatch.setattr("openai.OpenAI", lambda api_key: vision)

    style = find_style_set("9999", tmp_path, settings)

    assert style.from_scan is False
    assert style.source.name == "style_9999_clean.pdf"
    assert vision.calls == 0, "no image should be read while a text layer exists"


def test_a_scan_is_used_when_nothing_else_is_available(tmp_path, settings, monkeypatch):
    write_scanned_style_set(tmp_path / "style_1234.pdf")
    vision = FakeVision(_payload())
    monkeypatch.setattr("openai.OpenAI", lambda api_key: vision)

    style = find_style_set("1234", tmp_path, settings)
    assert style.from_scan is True


def test_a_scan_without_a_model_still_fails_the_lookup(tmp_path):
    write_scanned_style_set(tmp_path / "style_1234.pdf")
    with pytest.raises(StyleSetNotFound, match="no text layer"):
        find_style_set("1234", tmp_path)


def test_a_row_that_does_not_grade_is_reported(scanned, settings, monkeypatch):
    """The sheet checks itself. Garments do not shrink as the size goes up, so a
    run that wanders is the signature of a misread digit."""
    broken = _payload()
    broken["rows"][1]["values"] = ["26", "26 1/2", "21", "27 1/2"]  # 27 misread as 21
    vision = FakeVision(broken)
    monkeypatch.setattr("openai.OpenAI", lambda api_key: vision)

    style = read_style_set(scanned, settings)

    assert style.scan_warnings, "a value that drops mid-run must be reported"
    assert "1.01C" in style.scan_warnings[0]
    # Reported, never corrected: inventing a tidier number is the failure mode
    # this whole module exists to avoid.
    assert style.measured_rows()[0].specs["S"] == F(21)


def test_a_constant_row_is_not_mistaken_for_a_misread():
    """Most rows hold the same value across every size. That is normal."""
    rows = [
        PomRow("4.05A", "WAISTBAND HEIGHT", F(-1, 8), F(1, 8), dict.fromkeys(SIZES, F(5, 4))),
    ]
    assert suspect_rows(rows, SIZES) == []


def test_a_row_with_too_few_columns_says_nothing():
    """Two graded values cannot show a trend, so claiming one would be noise."""
    specs = {"XXS": F(26), "XS": None, "S": None, "M": F(20)}
    rows = [PomRow("1.01C", "FRONT LENGTH", F(-3, 8), F(3, 8), specs)]
    assert suspect_rows(rows, SIZES) == []


def test_blank_cells_stay_blank():
    """A cell the sheet leaves empty is not a zero."""
    read = {"sizes": list(SIZES), "rows": [
        {"pom": "1.01C", "description": "FRONT LENGTH", "tol_minus": "", "tol_plus": "",
         "values": ["26", "", "27", ""]}
    ]}
    row = parsed_rows(read, SIZES)[0]
    assert row.specs["XXS"] == F(26)
    assert row.specs["XS"] is None
    assert row.specs["M"] is None


def test_every_header_box_the_report_prints_is_read(scanned, settings, monkeypatch):
    """`graded_report.py` prints all ten. Reading only the style number left a
    vendor-facing sheet with blank boxes where the client's own details go."""
    payload = _payload() | {
        "description": "1234 SMOCKED BUTTON THROUGH",
        "season": "HOLIDAY-B 2026",
        "division": "02 / 035",
        "company": "AMERICAN EAGLE OUTFITTERS",
        "status": "FNL",
        "tolerance_model": "WW TOP L20",
        "pom_descr": "GRADED SPECIFICATION",
        "modified_by": "VANGR",
    }
    monkeypatch.setattr("openai.OpenAI", lambda api_key: FakeVision(payload))

    style = read_style_set(scanned, settings)

    assert style.description == "1234 SMOCKED BUTTON THROUGH"
    assert style.season == "HOLIDAY-B 2026"
    assert style.division == "02 / 035"
    assert style.company == "AMERICAN EAGLE OUTFITTERS"
    assert style.status == "FNL"
    assert style.tolerance_model == "WW TOP L20"
    assert style.pom_descr == "GRADED SPECIFICATION"
    assert style.modified_by == "VANGR"


def test_a_reference_row_of_zeros_is_not_called_a_misread():
    """Reference rows carry a value in the base size column and 0 elsewhere.

    Zero is a blank on these sheets, not a measurement, and reading it as one
    flagged a row style 7122 prints exactly right.
    """
    specs = dict.fromkeys(SIZES, F(0)) | {"S": F(22, 1)}
    rows = [PomRow("0.00B", "REF ONLY - FRONT LENGTH", None, None, specs)]
    assert suspect_rows(rows, SIZES) == []
