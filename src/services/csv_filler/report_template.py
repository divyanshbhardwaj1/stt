"""The client's Size Set Inspection Report form, loaded from their own .xls.

The template file is the authority on layout, not this module: labels, merged
regions and column widths are read from it at runtime. If the client revises the
form, drop in the new .xls and the CSV and PDF follow automatically.

Values are placed by looking up a label and writing into the cell beside it, so
inserting a row in the template does not break the filler.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

import xlrd

log = logging.getLogger(__name__)

# The form proper. Rows beyond this are photo-paste boxes and a second signature
# block, which we have no content for.
LAST_FORM_ROW = 57
FORM_COLUMNS = 20

# Accessory checklist: four label columns, each followed by MIS / ALT / ACT / PLA.
ACCESSORY_LABEL_COLUMNS = (0, 5, 10, 15)
ACCESSORY_STATUSES = ("MIS", "ALT", "ACT", "PLA")

# Labels in column 0 whose value belongs in column 5.
LABELLED_FIELDS = {
    "grain_line": "GRAIN LINE",
    "notches": "NOTCHES",
    "graded_nest": "GRADED NEST",
    "corrections_implemented": "CORRECTIONS  IMPLEMNTED",
    "yy_mini_marker": "YY/ MINI MARKER",
    "planned_submission_date": "PLANNED SIZE SET SUBMISSION DATE",
    "actual_submission_date": "ACTUAL SUBMISSION DATE",
    "pcd": "PCD",
    "cut_quantity": "CUT QUANTITY",
    "size_set_inspection_result": "SIZE SET INSPECTION RESULT",
    "shrinkage": "SHRINKAGE",
}
LABELLED_VALUE_COLUMN = 5

# Header fields, found by their label and written a fixed number of cells along.
HEADER_FIELDS = {
    "style_no": ("STYLE NO:", 1),
    "division": ("DIVISION:", 1),
    "date": ("DATE :", 2),
    "description": ("DESCRIPTION:", 1),
    "colour": ("COLOUR:", 2),
}

# The right-hand measurement block. Its first three rows carry printed tick-box
# text, so extracted values go into the blank rows underneath.
MEASUREMENT_BLOCK_LABEL = "CORRECTIONS TO BE DONE :-"
MEASUREMENT_BLOCK_COLUMN = 11

# Fields whose label lives in the measurement block rather than column 0.
MEASUREMENT_FIELDS = {
    "measurement_result": "RESULT",
    "measurement_graded_nest": "GRADED NEST :",
    "corrections_to_be_done": MEASUREMENT_BLOCK_LABEL,
    "cutting_check": "CUTTING CHECK",
    "seam_allowance": "SEAM ALLOWANCE",
    "checks_corrections_implemented": "CORRECTIONS IMPLEMENTED",
}

# Every field label the code expects to find, so a template revision that renames
# or removes one is caught at load rather than producing a quietly blank cell.
ALL_FIELD_LABELS = {
    **{name: label for name, (label, _) in HEADER_FIELDS.items()},
    **LABELLED_FIELDS,
    **MEASUREMENT_FIELDS,
}

# Words that must not be title-cased when a label is prettified for the PDF.
ACRONYMS = frozenset({"YY", "PCD", "PH", "UPC", "FOB", "HPS", "POM", "BOM", "NY"})

# Free-text comment rows: comment on the left, vendor action on the right.
COMMENTS_HEADER = "DETAILED COMMENTS"
COMMENT_COLUMN = 0
ACTION_COLUMN = 14
COMMENTS_END = "I AGREE WITH THE ABOVE COMMENTS"

# Preprinted section wording, located in the template rather than retyped.
REPORT_TITLE = "SIZE SET INSPECTION REPORT"
PATTERN_HEADER = "PATTERN CHECK LIST"
MEASUREMENT_HEADER = "MEASUREMENT (SPEC ATTACHED)"
SIGNATURE_LABEL = "VENDOR'S SIGNATURE"


class TemplateError(RuntimeError):
    """The report template is missing or does not look like the expected form."""


def _prettify(text: str) -> str:
    """'PLANNED SIZE SET SUBMISSION DATE' -> 'Planned Size Set Submission Date'."""
    words = []
    for word in text.strip(" -:").split():
        words.append(word if word.strip("/.,").upper() in ACRONYMS else word.capitalize())
    return " ".join(words)


def _first_phrase(text: str) -> str:
    """Drop the trailing caption some cells pad onto the end of a sentence."""
    return re.split(r"\s{3,}", text.strip())[0]


@dataclass(frozen=True)
class FormTemplate:
    """The blank form: its text, its merged regions and its column proportions."""

    grid: list[list[str]]
    merges: list[tuple[int, int, int, int]]
    column_widths: list[float]

    @property
    def row_count(self) -> int:
        return len(self.grid)

    def find_row(self, label: str, column: int = 0) -> int | None:
        """Row index whose cell in `column` starts with `label`, or None."""
        wanted = label.strip().casefold()
        for index, row in enumerate(self.grid):
            if column < len(row) and row[column].strip().casefold().startswith(wanted):
                return index
        return None

    def find_cell(self, label: str) -> tuple[int, int] | None:
        """(row, column) of the cell starting with `label`, searching every column.

        Header labels are scattered across the row — STYLE NO: sits in column 0
        but DIVISION:, DATE : and COLOUR: do not — so these cannot be found by
        scanning a single column.
        """
        wanted = label.strip().casefold()
        for row_index, row in enumerate(self.grid):
            for column, cell in enumerate(row):
                if cell.strip().casefold().startswith(wanted):
                    return row_index, column
        return None

    def accessory_items(self) -> list[tuple[str, int, int]]:
        """Every accessory checklist entry as (label, row, label column)."""
        header = self.find_row("ACCESSORIES")
        if header is None:
            return []
        items = []
        for row in range(header + 1, min(header + 12, self.row_count)):
            for column in ACCESSORY_LABEL_COLUMNS:
                label = self.grid[row][column].strip()
                if label:
                    items.append((label, row, column))
        return items

    def comment_rows(self) -> list[int]:
        """Blank rows between the comments header and the agreement line."""
        start = self.find_row(COMMENTS_HEADER)
        end = self.find_row(COMMENTS_END)
        if start is None:
            return []
        return list(range(start + 2, end if end is not None else self.row_count))

    def text_at(self, row: int | None, column: int) -> str:
        """The template's own text in a cell, or "" if it is not there."""
        if row is None or not 0 <= row < self.row_count:
            return ""
        return self.grid[row][column].strip()

    def display_label(self, field: str) -> str:
        """The form's own wording for a field, cleaned of tick-box furniture.

        Falls back to the field name for the handful of fields the report shows
        but the template has no printed label for.
        """
        raw = ALL_FIELD_LABELS.get(field)
        text = raw.split(":")[0] if raw else field.replace("_", " ")
        return _prettify(text)

    def boilerplate(self) -> dict[str, str]:
        """Preprinted wording lifted from the form, so none of it is retyped here."""
        signature_row = self.find_row(SIGNATURE_LABEL)
        return {
            "title": self.text_at(self.find_row(REPORT_TITLE), 0) or REPORT_TITLE,
            "accessories": self.text_at(self.find_row("ACCESSORIES"), 0),
            "pattern_checklist": self.text_at(self.find_row(PATTERN_HEADER), 0),
            "measurement": self.text_at(
                self.find_row(MEASUREMENT_HEADER, MEASUREMENT_BLOCK_COLUMN),
                MEASUREMENT_BLOCK_COLUMN,
            ),
            "comments": self.text_at(self.find_row(COMMENTS_HEADER), COMMENT_COLUMN),
            "actions": self.text_at(self.find_row(COMMENTS_HEADER), ACTION_COLUMN),
            "shrinkage": self.text_at(self.find_row("SHRINKAGE"), 0),
            # The agreement cell also carries the signature caption, padded apart.
            "agreement": _first_phrase(self.text_at(self.find_row(COMMENTS_END), 0)),
            "signature": self.text_at(signature_row, 0),
            "sent_via": self.text_at(signature_row, 5),
        }

    def missing_labels(self) -> list[str]:
        """Configured labels this template does not contain."""
        missing = [
            f"{field} -> {label!r}"
            for field, label in ALL_FIELD_LABELS.items()
            if self.find_cell(label) is None
        ]
        missing += [
            f"section -> {label!r}"
            for label in (REPORT_TITLE, "ACCESSORIES", COMMENTS_HEADER, COMMENTS_END)
            if self.find_cell(label) is None
        ]
        return missing

    def measurement_block_rows(self) -> list[int]:
        """Blank rows under 'CORRECTIONS TO BE DONE' in the measurement block."""
        start = self.find_row(MEASUREMENT_BLOCK_LABEL, MEASUREMENT_BLOCK_COLUMN)
        if start is None:
            return []
        rows = []
        for row in range(start + 1, self.row_count):
            if self.grid[row][MEASUREMENT_BLOCK_COLUMN].strip():
                break
            rows.append(row)
        return rows


def load_template(path: Path) -> FormTemplate:
    """Read the blank form out of the client's .xls."""
    if not path.is_file():
        raise TemplateError(
            f"report template not found at {path}. It is the client's blank "
            "'SIZE SET INSPECTION REPORT' workbook and must sit in data/references/."
        )
    try:
        book = xlrd.open_workbook(str(path), formatting_info=True)
        sheet = book.sheet_by_index(0)
    except Exception as exc:  # noqa: BLE001 - xlrd raises a wide range of errors
        raise TemplateError(f"could not read {path.name}: {exc}") from exc

    rows = min(sheet.nrows, LAST_FORM_ROW + 1)
    grid = [
        [
            str(sheet.cell_value(r, c)).strip() if c < sheet.ncols else ""
            for c in range(FORM_COLUMNS)
        ]
        for r in range(rows)
    ]
    merges = [
        (rlo, rhi - 1, clo, chi - 1)
        for rlo, rhi, clo, chi in sheet.merged_cells
        if rlo < rows and clo < FORM_COLUMNS
    ]
    widths = [
        sheet.computed_column_width(c) if c < sheet.ncols else 1000 for c in range(FORM_COLUMNS)
    ]

    template = FormTemplate(grid, sorted(merges), widths)
    if template.find_row(REPORT_TITLE) is None:
        raise TemplateError(f"{path.name} does not look like a Size Set Inspection Report")

    # Fail loudly on a revised template. Silently skipping a renamed label would
    # produce a report that looks complete but has quietly dropped fields.
    missing = template.missing_labels()
    if missing:
        raise TemplateError(
            f"{path.name} is missing labels this code expects:\n  "
            + "\n  ".join(missing)
            + "\nEither the template was revised or the wrong workbook is in "
            "data/references/. Update the label constants in report_template.py."
        )

    log.info("loaded template %s (%d rows)", path.name, template.row_count)
    return template
