"""Saves a filled inspection as a PDF laid out like the client's typed report.

Page 1 follows the report format: a centred title, the header line, the bordered
accessories checklist with its footnotes, then the two-column blocks for the
pattern checklist and measurement result, shrinkage, and the numbered comments
paired with vendor actions.

Accessory names and their grouping still come from the client's .xls, so a
revised template flows through to this page without a code change. Measurement
detail follows on later pages, since on paper it lives on the attached graded
spec sheet rather than on the report itself.
"""

from __future__ import annotations

import logging
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .inspection_record import InspectionRow, InspectionSheet
from .report_template import ACCESSORY_LABEL_COLUMNS, ACCESSORY_STATUSES, FormTemplate

log = logging.getLogger(__name__)

INK = colors.HexColor("#000000")
RULE = colors.HexColor("#999999")
FAINT = colors.HexColor("#cccccc")
MUTED = colors.HexColor("#777777")
FLAG = colors.HexColor("#b00020")
BAND = colors.HexColor("#f2f2f2")

MARGIN = 14 * mm
PAGE_WIDTH = A4[0] - 2 * MARGIN
COLUMN_WIDTH = PAGE_WIDTH / 2

# A literal check mark. ZapfDingbats looks like the "correct" answer here, but
# renderers substitute a filled box for every one of its glyphs; U+2713 in the
# ordinary text font is what actually draws a tick.
TICK = "✓"
BLANK = "-"

# Four groups must fit 182mm: 25.5 + 4 x 4.9 = 45.1mm each. The tick columns are
# sized so the MIS/ALT/ACT/PLA headings stay on one line.
ACCESSORY_NAME_WIDTH = 25.5 * mm
ACCESSORY_TICK_WIDTH = 4.9 * mm

SECTION_TITLES = {
    "construction": "Construction",
    "bom": "Bill of materials",
    "shrinkage": "Shrinkage",
    "marker": "Mini marker",
    "comment": "Comments and vendor actions",
}
MEASUREMENT_HEADINGS = ["No", "Point of measure", "Measured", "Dev", "Note", "Conf"]
MEASUREMENT_WIDTHS = [9 * mm, 62 * mm, 20 * mm, 14 * mm, 62 * mm, 13 * mm]
GENERAL_HEADINGS = ["No", "Item", "Value", "Note", "Conf"]
GENERAL_WIDTHS = [9 * mm, 56 * mm, 38 * mm, 64 * mm, 13 * mm]

# Which fields appear in which block, and in what order. The wording printed for
# each one is the template's own, via FormTemplate.display_label.
PATTERN_CHECKLIST = (
    "grain_line",
    "notches",
    "graded_nest",
    "corrections_implemented",
    "yy_mini_marker",
)
MEASUREMENT_BLOCK = (
    "measurement_result",
    "measurement_graded_nest",
    "corrections_to_be_done",
    "bring_back_to_specs",
)
SUBMISSION_FIELDS = (
    "planned_submission_date",
    "actual_submission_date",
    "pcd",
    "cut_quantity",
)
CHECK_FIELDS = ("cutting_check", "seam_allowance", "checks_corrections_implemented")


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["Normal"]
    return {
        "title": ParagraphStyle(
            "title", base, fontName="Helvetica-Bold", fontSize=13, alignment=1, spaceAfter=7
        ),
        "head": ParagraphStyle("head", base, fontName="Helvetica-Bold", fontSize=8.5, leading=12),
        "headplain": ParagraphStyle("headplain", base, fontSize=8.5, leading=12),
        "section": ParagraphStyle(
            "section", base, fontName="Helvetica-Bold", fontSize=8, leading=11, spaceBefore=6
        ),
        "body": ParagraphStyle("body", base, fontSize=7.5, leading=10),
        "bold": ParagraphStyle("bold", base, fontName="Helvetica-Bold", fontSize=7.5, leading=10),
        "grid": ParagraphStyle("grid", base, fontSize=6, leading=7.5),
        "gridhead": ParagraphStyle(
            "gridhead", base, fontName="Helvetica-Bold", fontSize=5, leading=7.5
        ),
        "tick": ParagraphStyle("tick", base, fontSize=7, leading=7.5, alignment=1),
        "note": ParagraphStyle(
            "note", base, fontName="Helvetica-Oblique", fontSize=6.2, leading=8.4
        ),
        "footer": ParagraphStyle(
            "footer", base, fontName="Helvetica-Oblique", fontSize=6.5, textColor=MUTED
        ),
        "cell": ParagraphStyle("cell", base, fontSize=7, leading=8.8),
    }


def _value(sheet: InspectionSheet, name: str) -> str:
    return sheet.field(name) or BLANK


def _title_block(
    sheet: InspectionSheet, printed: dict[str, str], styles: dict[str, ParagraphStyle]
) -> list[object]:
    """Centred title and the two header lines, titled in the form's own wording."""
    top = Table(
        [
            [
                Paragraph(f"STYLE NO# {_value(sheet, 'style_no')}", styles["head"]),
                Paragraph(f"DIVISION {_value(sheet, 'division')}", styles["head"]),
                Paragraph(f"Date: {_value(sheet, 'date')}", styles["head"]),
            ],
            [
                Paragraph(f"DESCRIPTION: {_value(sheet, 'description')}", styles["headplain"]),
                "",
                Paragraph(f"COLOUR: {_value(sheet, 'colour')}", styles["headplain"]),
            ],
        ],
        colWidths=[PAGE_WIDTH * 0.42, PAGE_WIDTH * 0.28, PAGE_WIDTH * 0.30],
        hAlign="LEFT",
    )
    top.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                ("SPAN", (0, 1), (1, 1)),
            ]
        )
    )
    return [Paragraph(printed["title"], styles["title"]), top]


def _accessory_groups(template: FormTemplate) -> list[list[str]]:
    """The checklist split back into its four printed columns."""
    groups: dict[int, list[str]] = {column: [] for column in ACCESSORY_LABEL_COLUMNS}
    for label, _, column in template.accessory_items():
        groups[column].append(label)
    return [groups[column] for column in ACCESSORY_LABEL_COLUMNS]


def _accessories_table(
    sheet: InspectionSheet, template: FormTemplate, styles: dict[str, ParagraphStyle]
) -> Table:
    """Four groups of name plus MIS / ALT / ACT / PLA, ticked where recorded."""
    groups = _accessory_groups(template)
    depth = max((len(group) for group in groups), default=0)

    header: list[object] = []
    for _ in groups:
        header.append(Paragraph("ACCESSORIES", styles["gridhead"]))
        header += [Paragraph(status, styles["gridhead"]) for status in ACCESSORY_STATUSES]
    data: list[list[object]] = [header]

    for depth_index in range(depth):
        row: list[object] = []
        for group in groups:
            item = group[depth_index] if depth_index < len(group) else ""
            status = sheet.status_for(item) if item else ""
            row.append(Paragraph(item, styles["grid"]))
            row += [
                Paragraph(TICK if status == wanted else "", styles["tick"])
                for wanted in ACCESSORY_STATUSES
            ]
        data.append(row)

    widths = [ACCESSORY_NAME_WIDTH, *([ACCESSORY_TICK_WIDTH] * 4)] * len(groups)
    table = Table(data, colWidths=widths, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, RULE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ]
        )
    )
    return table


def _labelled_lines(
    sheet: InspectionSheet,
    template: FormTemplate,
    fields: tuple[str, ...],
    styles: dict[str, ParagraphStyle],
) -> list[object]:
    """One 'Label: value' line per field, labelled in the form's own words."""
    return [
        Paragraph(f"{template.display_label(name)}: {_value(sheet, name)}", styles["body"])
        for name in fields
    ]


def _two_columns(left: list[object], right: list[object]) -> Table:
    """A borderless two-column block."""
    table = Table([[left, right]], colWidths=[COLUMN_WIDTH, COLUMN_WIDTH], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return table


def _comments_table(
    sheet: InspectionSheet, printed: dict[str, str], styles: dict[str, ParagraphStyle]
) -> Table:
    """Numbered comments on the left, vendor actions on the right, ruled between."""
    data: list[list[object]] = [
        [
            Paragraph(printed["comments"], styles["section"]),
            Paragraph(printed["actions"], styles["section"]),
        ]
    ]
    for number, comment in enumerate(sheet.comments, 1):
        data.append(
            [
                Paragraph(f"({number}) {comment.comment}", styles["body"]),
                Paragraph(comment.vendor_action, styles["body"]),
            ]
        )
    if not sheet.comments:
        data.append([Paragraph(BLANK, styles["body"]), Paragraph("", styles["body"])])

    table = Table(data, colWidths=[COLUMN_WIDTH, COLUMN_WIDTH], hAlign="LEFT", repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 1), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
                ("LINEBELOW", (0, 1), (-1, -2), 0.3, FAINT),
            ]
        )
    )
    return table


def _signature_block(printed: dict[str, str], styles: dict[str, ParagraphStyle]) -> list[object]:
    """The agreement and signature captions, in the form's own preprinted wording."""
    line = Table([[""]], colWidths=[62 * mm], rowHeights=[8 * mm], hAlign="LEFT")
    line.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.5, FAINT)]))
    footer = Table(
        [
            [
                Paragraph(printed["signature"], styles["body"]),
                Paragraph(printed["sent_via"], styles["body"]),
            ]
        ],
        colWidths=[COLUMN_WIDTH, COLUMN_WIDTH],
        hAlign="LEFT",
    )
    footer.setStyle(
        TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 2)])
    )
    return [Paragraph(printed["agreement"], styles["body"]), line, footer]


def _report_page(
    sheet: InspectionSheet, template: FormTemplate, styles: dict[str, ParagraphStyle]
) -> list[object]:
    printed = template.boilerplate()
    story: list[object] = [*_title_block(sheet, printed, styles), Spacer(1, 3 * mm)]

    story.append(Paragraph(f"{printed['accessories']} CHECKLIST", styles["section"]))
    story.append(Spacer(1, 1.5 * mm))
    story.append(_accessories_table(sheet, template, styles))

    notes = sheet.accessory_notes()
    if notes:
        story.append(Spacer(1, 2 * mm))
        story += [Paragraph(f"* {check.item}: {check.note}", styles["note"]) for check in notes]

    story.append(Spacer(1, 3 * mm))
    story.append(
        _two_columns(
            [
                Paragraph(printed["pattern_checklist"], styles["section"]),
                *_labelled_lines(sheet, template, PATTERN_CHECKLIST, styles),
            ],
            [
                Paragraph(printed["measurement"], styles["section"]),
                *_labelled_lines(sheet, template, MEASUREMENT_BLOCK, styles),
            ],
        )
    )

    story.append(Spacer(1, 3 * mm))
    story.append(
        _two_columns(
            _labelled_lines(sheet, template, SUBMISSION_FIELDS, styles),
            _labelled_lines(sheet, template, CHECK_FIELDS, styles),
        )
    )
    story.append(
        Paragraph(
            f"{template.display_label('size_set_inspection_result')}: "
            f"{_value(sheet, 'size_set_inspection_result')}",
            styles["bold"],
        )
    )

    story.append(Spacer(1, 3 * mm))
    story.append(
        _two_columns(
            [
                Paragraph(
                    f"<b>{printed['shrinkage']}</b>&nbsp;&nbsp;SHELL: {_value(sheet, 'shrinkage')}",
                    styles["body"],
                )
            ],
            [Paragraph(f"LINING: {_value(sheet, 'lining_shrinkage')}", styles["body"])],
        )
    )
    if sheet.field("shrinkage_note"):
        story.append(Paragraph(sheet.field("shrinkage_note"), styles["note"]))

    story.append(Spacer(1, 3 * mm))
    story.append(_comments_table(sheet, printed, styles))

    if sheet.field("overall"):
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph(f"OVERALL: {sheet.field('overall')}", styles["bold"]))

    story.append(Spacer(1, 4 * mm))
    story += _signature_block(printed, styles)
    story.append(Spacer(1, 4 * mm))
    story.append(
        Paragraph(
            "Auto-generated from meeting recording transcript - demo pipeline output",
            styles["footer"],
        )
    )
    return story


def _detail_table(
    rows: list[tuple[int, InspectionRow]],
    headings: list[str],
    widths: list[float],
    cell: ParagraphStyle,
    measurement: bool,
) -> Table:
    """Numbered rows. The number is the report-wide one, so it matches the CSV."""
    data: list[list[object]] = [list(headings)]
    flagged = set()
    for position, (number, row) in enumerate(rows, 1):
        if row.needs_review:
            flagged.add(position)
        stated = " ".join(part for part in (row.value, row.deviation) if part)
        columns = (
            [str(number), Paragraph(row.field, cell), row.value, row.deviation]
            if measurement
            else [str(number), Paragraph(row.field, cell), Paragraph(stated, cell)]
        )
        data.append([*columns, Paragraph(row.note, cell), f"{row.confidence:.2f}"])

    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    style = [
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 7),
        ("BACKGROUND", (0, 0), (-1, 0), BAND),
        ("GRID", (0, 0), (-1, -1), 0.25, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]
    style += [("TEXTCOLOR", (0, index), (-1, index), FLAG) for index in flagged]
    table.setStyle(TableStyle(style))
    return table


def _detail_pages(sheet: InspectionSheet, styles: dict[str, ParagraphStyle], source: str):
    flagged = sheet.flagged()
    story: list[object] = [
        PageBreak(),
        Paragraph("MEASUREMENT DETAIL (ATTACHED SPEC SHEET)", styles["title"]),
        Paragraph(
            f"{sheet.headline() or 'Extracted from recording'} · Source: {source or 'transcript'} "
            f"· {len(sheet.rows)} rows · "
            f"<font color='#b00020'>{len(flagged)} need review (shown in red)</font>",
            styles["footer"],
        ),
        Spacer(1, 3 * mm),
    ]

    for size in sheet.sizes():
        rows = sheet.rows_in("measurement", size)
        story.append(
            KeepTogether(
                [
                    Paragraph(f"Size {size} ({len(rows)})", styles["section"]),
                    _detail_table(
                        rows, MEASUREMENT_HEADINGS, MEASUREMENT_WIDTHS, styles["cell"], True
                    ),
                ]
            )
        )

    for section, title in SECTION_TITLES.items():
        rows = sheet.rows_in(section)
        if not rows:
            continue
        story.append(Paragraph(title, styles["section"]))
        story.append(_detail_table(rows, GENERAL_HEADINGS, GENERAL_WIDTHS, styles["cell"], False))
    return story


def save_pdf(
    sheet: InspectionSheet,
    template: FormTemplate,
    path: Path,
    source: str = "",
) -> Path:
    """Render the report, then the measurement detail on following pages."""
    path.parent.mkdir(parents=True, exist_ok=True)
    styles = _styles()
    document = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        title=f"Size Set Inspection Report {sheet.field('style_no')}".strip(),
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
    )

    story = _report_page(sheet, template, styles)
    if sheet.rows:
        story += _detail_pages(sheet, styles, source)

    document.build(story)
    log.info("wrote %s", path)
    return path
