"""Builds a stand-in Size Set Inspection Report workbook for the tests.

The client's real form is confidential and gitignored, so CI never sees it. This
writes a workbook with the same structure — the labels the code looks for, the
four accessory groups, the comment rows — from the constants in
`report_template`, so a test template can never drift from what the code expects.

Tests that must exercise the genuine client file are marked `real_template` and
skip when it is absent.
"""

from __future__ import annotations

from pathlib import Path

import xlwt

from services.csv_filler.report_template import (
    ACCESSORY_LABEL_COLUMNS,
    ACCESSORY_STATUSES,
    COMMENTS_END,
    COMMENTS_HEADER,
    HEADER_FIELDS,
    LABELLED_FIELDS,
    MEASUREMENT_BLOCK_COLUMN,
    MEASUREMENT_BLOCK_LABEL,
    MEASUREMENT_FIELDS,
    MEASUREMENT_HEADER,
    PATTERN_HEADER,
    REPORT_TITLE,
    SIGNATURE_LABEL,
)

# Rows chosen to mirror the client's form closely enough for the coordinate
# constants in report_template to hold: header at 3 and 5, accessories from 8,
# labelled fields from 21, comments from 37.
# Where each header label sits. The label text itself comes from HEADER_FIELDS,
# so the stand-in cannot drift from the strings the code searches for.
HEADER_PLACEMENT = {
    "style_no": (3, 0),
    "division": (3, 5),
    "date": (3, 11),
    "description": (5, 0),
    "colour": (5, 11),
}
ACCESSORY_HEADER_ROW = 7
ACCESSORY_FIRST_ROW = 8
COMMENTS_ROW = 35
FIRST_COMMENT_ROW = 37
AGREEMENT_ROW = 55
SIGNATURE_ROW = 57

# Four groups of accessory names, mirroring the real form's shape.
ACCESSORY_GROUPS = [
    ["MAIN LABEL", "BOOK FOLD", "FCTY CODE", "HANG TAG", "HANGER", "WASHCARE", "INTERLINING"],
    [
        "POLYBAG",
        "POLY BAG STICKER",
        "LOT STICKER",
        "PRE PACK STICKER",
        "CARTON MARKINGS",
        "PLACEMENT UPC/P.PACK",
        "FOLDING",
        "SPARE BUTTON POSITION",
    ],
    ["BUTTON", "HOOK EYE/BAR", "LACE", "BUCKLE", "SNAP", "THREAD", "LINING", "ZIPPER"],
    ["PRINT", "LAYOUT", "EMB THREAD COLOR", "PLACEMENT", "BEADS/SEQUINS", "AFTER TREATMENT"],
]

# Merged regions the writers rely on: the title banner, the header value cells,
# and the comment / vendor-action columns.
MERGES = [
    (3, 3, 1, 4),
    (3, 3, 6, 10),
    (3, 3, 13, 15),
    (5, 5, 1, 5),
    (5, 5, 13, 15),
]


def write_form_template(path: Path) -> Path:
    """Write a stand-in report workbook that `load_template` accepts."""
    path.parent.mkdir(parents=True, exist_ok=True)
    book = xlwt.Workbook()
    sheet = book.add_sheet("SIZE SET INSPECTION REPORT")

    sheet.write_merge(2, 2, 0, 19, REPORT_TITLE)
    for name, (row, column) in HEADER_PLACEMENT.items():
        sheet.write(row, column, HEADER_FIELDS[name][0])
    for row_lo, row_hi, col_lo, col_hi in MERGES:
        sheet.write_merge(row_lo, row_hi, col_lo, col_hi, "")
    for row in range(FIRST_COMMENT_ROW + 1, AGREEMENT_ROW):
        sheet.write_merge(row, row, 0, 13, "")
        sheet.write_merge(row, row, 14, 19, "")

    # Accessories grid: a label column then MIS / ALT / ACT / PLA, four times over.
    for column in ACCESSORY_LABEL_COLUMNS:
        sheet.write(ACCESSORY_HEADER_ROW, column, "ACCESSORIES")
        for offset, status in enumerate(ACCESSORY_STATUSES, 1):
            sheet.write(ACCESSORY_HEADER_ROW, column + offset, status)
    for group, column in zip(ACCESSORY_GROUPS, ACCESSORY_LABEL_COLUMNS, strict=True):
        for offset, item in enumerate(group):
            sheet.write(ACCESSORY_FIRST_ROW + offset, column, item)

    # Pattern checklist and the other column-0 labelled fields.
    sheet.write(20, 0, PATTERN_HEADER)
    for row, label in enumerate(LABELLED_FIELDS.values(), start=21):
        sheet.write(row, 0, label)
        sheet.write(row, 4, ":")

    # Measurement block down the right-hand side. The blank rows under
    # "corrections to be done" matter: that is where the filler writes.
    sheet.write(20, MEASUREMENT_BLOCK_COLUMN, MEASUREMENT_HEADER)
    block_rows = {
        "measurement_result": 21,
        "measurement_graded_nest": 22,
        "corrections_to_be_done": 23,
        "cutting_check": 31,
        "seam_allowance": 32,
        "checks_corrections_implemented": 33,
    }
    for name, label in MEASUREMENT_FIELDS.items():
        text = MEASUREMENT_BLOCK_LABEL if name == "corrections_to_be_done" else label
        sheet.write(block_rows[name], MEASUREMENT_BLOCK_COLUMN, text)

    sheet.write(COMMENTS_ROW, 0, COMMENTS_HEADER)
    sheet.write(COMMENTS_ROW, 14, "ACTION TO BE TAKEN BY VENDOR")
    sheet.write(FIRST_COMMENT_ROW, 0, "Red col")  # the stray placeholder the real form ships
    sheet.write(AGREEMENT_ROW, 0, f"{COMMENTS_END} AND WILL INCORPORATE ALL ABOVE COMMENTS")
    sheet.write(SIGNATURE_ROW, 0, SIGNATURE_LABEL)
    sheet.write(SIGNATURE_ROW, 5, "SENT VIA MAIL")

    book.save(str(path))
    return path
