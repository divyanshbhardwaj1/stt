"""CSV filler service: the template, the form filler, extraction, and both writers."""

import csv
import json
import types

import pytest

from services.csv_filler import (
    ExtractionError,
    InspectionRow,
    InspectionSheet,
    TemplateError,
    extract_inspection,
    fill_form,
    load_json,
    load_template,
    measurements_path_for,
    save_form_csv,
    save_json,
    save_measurements_csv,
    save_pdf,
)
from services.csv_filler.report_template import FORM_COLUMNS

from .conftest import REAL_TEMPLATE, SHEET_PAYLOAD


class FakeExtractionClient:
    """Returns whatever JSON it is given, the way the Responses API would."""

    def __init__(self, payload=SHEET_PAYLOAD):
        self.payload = payload
        self.calls = []
        self.responses = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        body = self.payload if isinstance(self.payload, str) else json.dumps(self.payload)
        return types.SimpleNamespace(output_text=body)


# --- template ---------------------------------------------------------------


def test_template_loads_the_clients_form(template):
    assert template.find_row("SIZE SET INSPECTION REPORT") is not None
    assert all(len(row) == FORM_COLUMNS for row in template.grid)
    assert template.merges


def test_template_lists_every_accessory(template):
    items = [label for label, _, _ in template.accessory_items()]

    assert "MAIN LABEL" in items
    assert "INTERLINING" in items
    assert "SPARE BUTTON POSITION" in items
    assert len(items) > 20


def test_template_finds_the_comment_rows(template):
    rows = template.comment_rows()

    assert len(rows) > 5
    assert all(row > template.find_row("DETAILED COMMENTS") for row in rows)


def test_template_wording_comes_from_the_file_not_the_code(template):
    """Section headings and captions are the client's own text, read at load."""
    printed = template.boilerplate()

    assert printed["title"] == "SIZE SET INSPECTION REPORT"
    assert printed["pattern_checklist"] == "PATTERN CHECK LIST"
    assert printed["measurement"] == "MEASUREMENT (SPEC ATTACHED)"
    assert printed["comments"] == "DETAILED COMMENTS"
    assert printed["actions"] == "ACTION TO BE TAKEN BY VENDOR"
    assert printed["signature"] == "VENDOR'S SIGNATURE"
    assert printed["sent_via"] == "SENT VIA MAIL"


def test_agreement_caption_is_trimmed_of_its_padded_suffix(template):
    """The template pads the signature caption onto the end of the same cell."""
    agreement = template.boilerplate()["agreement"]

    assert agreement.startswith("I AGREE WITH THE ABOVE COMMENTS")
    assert "SIGNATURE" not in agreement


def test_display_labels_come_from_the_template(template):
    assert template.display_label("cut_quantity") == "Cut Quantity"
    assert template.display_label("pcd") == "PCD"  # acronyms survive prettifying
    assert template.display_label("yy_mini_marker").startswith("YY/")
    assert template.display_label("corrections_to_be_done") == "Corrections To Be Done"


def test_display_label_falls_back_for_fields_the_form_does_not_print(template):
    """Some report fields have no printed label; the field name is prettified."""
    assert template.display_label("bring_back_to_specs") == "Bring Back To Specs"
    assert template.display_label("lining_shrinkage") == "Lining Shrinkage"


def test_a_template_with_a_renamed_label_is_rejected_loudly(tmp_path, monkeypatch):
    """A revised form must fail at load, not silently drop the field it renamed."""
    from services.csv_filler import report_template as module

    monkeypatch.setitem(module.ALL_FIELD_LABELS, "cut_quantity", "TOTAL PIECES CUT")

    with pytest.raises(TemplateError, match="TOTAL PIECES CUT"):
        load_template(REAL_TEMPLATE)


def test_template_rejects_a_missing_file(tmp_path):
    with pytest.raises(TemplateError, match="not found"):
        load_template(tmp_path / "absent.xls")


def test_template_rejects_a_file_that_is_not_the_form(tmp_path):
    junk = tmp_path / "junk.xls"
    junk.write_bytes(b"not a workbook")

    with pytest.raises(TemplateError, match="could not read"):
        load_template(junk)


# --- form filler ------------------------------------------------------------


def test_fill_places_the_header_fields(sheet, template):
    grid = fill_form(sheet, template)
    flat = "\n".join(" ".join(row) for row in grid)

    assert "7270" in flat
    assert "Snow Flake" in flat
    assert "Short Sleeve Button Up Monica" in flat


def test_fill_places_labelled_fields_beside_their_labels(sheet, template):
    grid = fill_form(sheet, template)
    row = template.find_row("CUT QUANTITY")

    assert grid[row][5] == "06 pcs"


def test_fill_ticks_only_the_accessories_that_were_covered(sheet, template):
    grid = fill_form(sheet, template)
    ticks = {(r, c) for r, row in enumerate(grid) for c, cell in enumerate(row) if cell == "X"}

    assert len(ticks) == 3  # MAIN LABEL, INTERLINING, THREAD


def test_fill_puts_the_accessory_tick_in_the_right_status_column(sheet, template):
    grid = fill_form(sheet, template)
    row, column = next(
        (r, c) for label, r, c in template.accessory_items() if label == "INTERLINING"
    )

    assert grid[row][column + 3] == "X"  # ACT is the third status column


def test_fill_numbers_the_comments_and_pairs_the_actions(sheet, template):
    grid = fill_form(sheet, template)
    rows = template.comment_rows()

    assert grid[rows[0]][0] == "(1) Front bodice shirring uneven"
    assert grid[rows[0]][14] == "Follow notches"
    assert grid[rows[1]][0] == "(2) Stain at placket"


def test_fill_clears_the_templates_stray_placeholder(sheet, template):
    grid = fill_form(sheet, template)

    assert "Red col" not in "\n".join(" ".join(row) for row in grid)


def test_fill_annotates_the_printed_tick_box_lines(sheet, template):
    grid = fill_form(sheet, template)
    row = template.find_row("CUTTING CHECK", 11)

    assert grid[row][11].startswith("CUTTING CHECK")
    assert grid[row][11].endswith("OK")


def test_fill_leaves_unstated_fields_blank(template):
    empty = InspectionSheet.from_payload({"form": {}, "rows": []})

    grid = fill_form(empty, template)

    assert grid[template.find_row("CUT QUANTITY")][5] == ""


def test_fill_does_not_mutate_the_template(sheet, template):
    before = [row[:] for row in template.grid]

    fill_form(sheet, template)

    assert template.grid == before


# --- extraction -------------------------------------------------------------


def test_extract_builds_a_sheet(settings, template):
    result = extract_inspection("transcript", settings, template, client=FakeExtractionClient())

    assert result.field("style_no") == "7270"
    assert len(result.rows) == 5
    assert len(result.accessories) == 3


def test_extract_constrains_accessories_to_the_templates_names(settings, template):
    client = FakeExtractionClient()

    extract_inspection("transcript", settings, template, client=client)

    schema = client.calls[0]["text"]["format"]["schema"]
    allowed = schema["properties"]["accessories"]["items"]["properties"]["item"]["enum"]
    assert "MAIN LABEL" in allowed
    assert client.calls[0]["text"]["format"]["strict"] is True


def test_extract_lists_the_accessory_names_in_the_prompt(settings, template):
    client = FakeExtractionClient()

    extract_inspection("transcript", settings, template, client=client)

    assert "SPARE BUTTON POSITION" in client.calls[0]["input"][0]["content"]


def test_extract_rejects_an_empty_transcript(settings, template):
    with pytest.raises(ExtractionError, match="empty"):
        extract_inspection("   ", settings, template, client=FakeExtractionClient())


def test_extract_rejects_unparseable_output(settings, template):
    client = FakeExtractionClient(payload="not json")

    with pytest.raises(ExtractionError, match="usable JSON"):
        extract_inspection("text", settings, template, client=client)


def test_extract_rejects_an_empty_result(settings, template):
    client = FakeExtractionClient(payload={**SHEET_PAYLOAD, "rows": [], "comments": []})

    with pytest.raises(ExtractionError, match="nothing to fill"):
        extract_inspection("text", settings, template, client=client)


# --- the record shape -------------------------------------------------------


def test_sizes_are_listed_in_dictation_order(sheet):
    assert sheet.sizes() == ["M", "L"]


def test_status_for_is_case_insensitive(sheet):
    assert sheet.status_for("main label") == "ALT"
    assert sheet.status_for("ZIPPER") == ""


def test_headline_joins_the_stated_fields(sheet):
    assert sheet.headline() == (
        "Style 7270 · Short Sleeve Button Up Monica · Colour Snow Flake · Pass with comment"
    )


def test_low_confidence_rows_are_flagged(sheet):
    assert [row.field for _, row in sheet.flagged()] == ["Side seam tie length", "Stain at placket"]


def test_flagged_rows_carry_their_report_number(sheet):
    """The number is the reviewer's handle on a row, so it must survive filtering."""
    assert [number for number, _ in sheet.flagged()] == [3, 5]


def test_numbering_runs_across_the_whole_extraction(sheet):
    """Not per section — otherwise two different rows would both be '#1'."""
    assert [number for number, _ in sheet.numbered()] == [1, 2, 3, 4, 5]
    assert [number for number, _ in sheet.rows_in("shrinkage")] == [4]
    assert [number for number, _ in sheet.rows_in("measurement", "L")] == [3]


def test_a_confident_row_is_not_flagged_despite_a_note():
    """Notes are context, not doubt — flagging on them buried the real problems."""
    row = InspectionRow("measurement", "M", "Shoulder seam", "1 3/8", "+1/8", "spoken as 1.38", 1.0)

    assert not row.needs_review


def test_json_round_trips(sheet, tmp_path):
    path = save_json(sheet, tmp_path / "x.json")

    assert load_json(path) == sheet


# --- writers ----------------------------------------------------------------


def test_form_csv_matches_the_template_geometry(sheet, template, tmp_path):
    path = save_form_csv(sheet, template, tmp_path / "x.csv")

    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle))

    assert len(rows) == template.row_count
    assert all(len(row) == FORM_COLUMNS for row in rows)
    assert any("SIZE SET INSPECTION REPORT" in cell for cell in rows[2])


def test_form_csv_carries_the_filled_values(sheet, template, tmp_path):
    path = save_form_csv(sheet, template, tmp_path / "x.csv")

    assert "Snow Flake" in path.read_text(encoding="utf-8-sig")


def test_form_csv_is_excel_readable_utf8(sheet, template, tmp_path):
    """The BOM is what makes Excel on Windows render the Hindi in comments correctly."""
    path = save_form_csv(sheet, template, tmp_path / "x.csv")

    assert path.read_bytes().startswith(b"\xef\xbb\xbf")


def test_measurements_csv_sits_beside_the_form_csv(tmp_path):
    assert measurements_path_for(tmp_path / "R20.csv").name == "R20-measurements.csv"


def test_measurements_csv_has_a_review_column(sheet, tmp_path):
    path = save_measurements_csv(sheet, tmp_path / "x-measurements.csv")

    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    assert len(rows) == 5
    assert rows[0]["value"] == "22 1/8"
    assert rows[0]["needs_review"] == ""
    assert rows[2]["needs_review"] == "yes"


def test_measurements_csv_is_numbered(sheet, tmp_path):
    path = save_measurements_csv(sheet, tmp_path / "x-measurements.csv")

    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    assert [row["no"] for row in rows] == ["1", "2", "3", "4", "5"]


def test_pdf_is_written(sheet, template, tmp_path):
    path = save_pdf(sheet, template, tmp_path / "x.pdf", source="Recording_20")

    assert path.read_bytes().startswith(b"%PDF")
    assert path.stat().st_size > 2000


def test_pdf_renders_the_form_even_with_no_measurements(template, tmp_path):
    bare = InspectionSheet.from_payload({**SHEET_PAYLOAD, "rows": []})

    path = save_pdf(bare, template, tmp_path / "x.pdf")

    assert path.read_bytes().startswith(b"%PDF")


def test_pdf_renders_an_entirely_empty_sheet(template, tmp_path):
    """Nothing extracted must still produce the blank report, not a crash."""
    empty = InspectionSheet.from_payload(
        {"form": {}, "accessories": [], "comments": [], "rows": []}
    )

    path = save_pdf(empty, template, tmp_path / "x.pdf")

    assert path.read_bytes().startswith(b"%PDF")


def test_accessory_notes_are_only_the_ones_carrying_a_qualifier(sheet):
    assert [check.item for check in sheet.accessory_notes()] == ["MAIN LABEL"]


def test_check_for_returns_the_whole_entry(sheet):
    assert sheet.check_for("main label").note == "Pending - needs to be printed"
    assert sheet.check_for("ZIPPER") is None
