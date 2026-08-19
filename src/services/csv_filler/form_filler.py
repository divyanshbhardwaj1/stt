"""Places extracted values into the client's blank form, producing a filled grid.

The result is one grid of strings with exactly the template's geometry, which is
what both the CSV writer and the PDF writer render. Neither of them knows where
a field belongs — that lives here, once.
"""

from __future__ import annotations

import logging

from .inspection_record import InspectionSheet
from .report_template import (
    ACCESSORY_STATUSES,
    ACTION_COLUMN,
    COMMENT_COLUMN,
    HEADER_FIELDS,
    LABELLED_FIELDS,
    LABELLED_VALUE_COLUMN,
    MEASUREMENT_BLOCK_COLUMN,
    MEASUREMENT_FIELDS,
    FormTemplate,
)

log = logging.getLogger(__name__)

# The measurement-block fields whose printed tick-box line is annotated rather
# than overwritten. `corrections_to_be_done` is excluded: it is long free text
# and goes into the blank rows underneath instead.
ANNOTATED_FIELDS = tuple(name for name in MEASUREMENT_FIELDS if name != "corrections_to_be_done")


def fill_form(sheet: InspectionSheet, template: FormTemplate) -> list[list[str]]:
    """Return a copy of the template grid with every extracted value placed."""
    grid = [row[:] for row in template.grid]

    _fill_header(grid, sheet, template)
    _fill_labelled_fields(grid, sheet, template)
    _fill_accessories(grid, sheet, template)
    _fill_measurement_block(grid, sheet, template)
    _fill_comments(grid, sheet, template)
    return grid


def _place(grid: list[list[str]], row: int | None, column: int, value: str) -> None:
    """Write `value` if there is somewhere to put it and something to write."""
    if row is None or not value or not 0 <= row < len(grid) or not 0 <= column < len(grid[row]):
        return
    grid[row][column] = value


def _fill_header(grid: list[list[str]], sheet: InspectionSheet, template: FormTemplate) -> None:
    """Header labels sit at scattered columns, so each is located then written past."""
    for name, (label, offset) in HEADER_FIELDS.items():
        found = template.find_cell(label)
        if found is None:
            log.warning("header label %r is not on the template", label)
            continue
        row, column = found
        _place(grid, row, column + offset, sheet.field(name))


def _fill_labelled_fields(
    grid: list[list[str]], sheet: InspectionSheet, template: FormTemplate
) -> None:
    for name, label in LABELLED_FIELDS.items():
        _place(grid, template.find_row(label), LABELLED_VALUE_COLUMN, sheet.field(name))


def _fill_accessories(
    grid: list[list[str]], sheet: InspectionSheet, template: FormTemplate
) -> None:
    """Tick the MIS/ALT/ACT/PLA cell for every accessory the recording covered."""
    for item, row, label_column in template.accessory_items():
        status = sheet.status_for(item)
        if status not in ACCESSORY_STATUSES:
            continue
        _place(grid, row, label_column + 1 + ACCESSORY_STATUSES.index(status), "X")


def _fill_measurement_block(
    grid: list[list[str]], sheet: InspectionSheet, template: FormTemplate
) -> None:
    """The right-hand block: every tick-box line, plus corrections to be done."""
    for name in ANNOTATED_FIELDS:
        _annotate(grid, template, MEASUREMENT_FIELDS[name], sheet.field(name))

    corrections = sheet.field("corrections_to_be_done")
    rows = template.measurement_block_rows()
    if corrections and rows:
        for line, row in zip(_wrap(corrections, len(rows)), rows, strict=False):
            _place(grid, row, MEASUREMENT_BLOCK_COLUMN, line)


def _annotate(grid: list[list[str]], template: FormTemplate, label: str, value: str) -> None:
    """Append a stated result to a printed tick-box line, keeping the printed text."""
    if not value:
        return
    row = template.find_row(label, MEASUREMENT_BLOCK_COLUMN)
    if row is None:
        return
    grid[row][MEASUREMENT_BLOCK_COLUMN] = (
        f"{template.grid[row][MEASUREMENT_BLOCK_COLUMN]}  ->  {value}"
    )


def _fill_comments(grid: list[list[str]], sheet: InspectionSheet, template: FormTemplate) -> None:
    """Numbered comments on the left, vendor actions on the right."""
    rows = template.comment_rows()
    if not rows:
        return
    # The template ships with a stray "Red col" note in the first comment row.
    for row in rows:
        grid[row][COMMENT_COLUMN] = ""
        grid[row][ACTION_COLUMN] = ""

    overflow = len(sheet.comments) - len(rows)
    for index, (comment, row) in enumerate(zip(sheet.comments, rows, strict=False), 1):
        grid[row][COMMENT_COLUMN] = f"({index}) {comment.comment}"
        grid[row][ACTION_COLUMN] = comment.vendor_action
    if overflow > 0:
        log.warning("%d comments did not fit the form's %d rows", overflow, len(rows))
        grid[rows[-1]][COMMENT_COLUMN] = f"... {overflow} further comments, see the CSV"


def _wrap(text: str, limit: int) -> list[str]:
    """Split `text` onto at most `limit` lines, one sentence-ish chunk per line."""
    parts = [part.strip() for part in text.split(";") if part.strip()] or [text]
    if len(parts) <= limit:
        return parts
    return [*parts[: limit - 1], " ".join(parts[limit - 1 :])]
