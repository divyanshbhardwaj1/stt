"""Writes the inspection result in the style set's own format.

The client reads graded spec sheets all day, so the report is laid out the same
way: POM, description, Tol-, Tol+, then one column per size. Where the style set
prints the specified measurement, this prints what was actually measured, with
the deviation beneath it and anything outside tolerance in red.
"""

from __future__ import annotations

import csv
import logging
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from services.measurements import format_measurement as fmt
from services.style_set import Alignment, StyleSet

log = logging.getLogger(__name__)

RULE = colors.HexColor("#9a9a9a")
HEAD_BG = colors.HexColor("#1f3864")
HEAD_INK = colors.HexColor("#ffffff")
BAND = colors.HexColor("#eef1f6")
MUTED = colors.HexColor("#6b7280")

# Cell ink. Out of tolerance reads orange rather than red: red is the colour the
# style sets already use for their own printing, and these are findings to check
# rather than errors in the sheet.
INK_HEX = "#111111"
FAIL_HEX = "#c2410c"
LOW_CONFIDENCE_HEX = "#1d4ed8"
MISSING_HEX = "#a0a4ab"
MUTED_HEX = "#6b7280"
FAIL_BG = colors.HexColor("#fdf0e6")
NOT_MEASURED_BG = colors.HexColor("#fafbfc")
# Triburg highlight the base-size column in yellow on every sheet.
BASE_SIZE_BG = colors.HexColor("#ffffcc")
BASE_SIZE_HEAD = colors.HexColor("#ffff00")

# Below this the transcription of the value was uncertain, so the number is
# printed in blue: it may be right, but it was not clearly heard.
CONFIDENCE_FLOOR = 0.90

MARGIN = 12 * mm
PAGE_WIDTH = landscape(A4)[0] - 2 * MARGIN
POM_WIDTH = 15 * mm
DESCRIPTION_WIDTH = 62 * mm
TOLERANCE_WIDTH = 11 * mm
MIN_SIZE_WIDTH = 13 * mm
BLANK = "-"


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["Normal"]
    return {
        "title": ParagraphStyle(
            "t", base, fontName="Helvetica-Bold", fontSize=12, alignment=1, spaceAfter=3
        ),
        "sub": ParagraphStyle("s", base, fontSize=8, alignment=1, textColor=MUTED, spaceAfter=8),
        "banner": ParagraphStyle(
            "b", base, fontName="Helvetica-Bold", fontSize=8.5, alignment=1, textColor=HEAD_INK
        ),
        "meta": ParagraphStyle("m", base, fontSize=7, leading=9),
        "label": ParagraphStyle("l", base, fontName="Helvetica-Bold", fontSize=7, leading=9),
        "stylebar": ParagraphStyle(
            "sb", base, fontName="Helvetica-Bold", fontSize=11, textColor=HEAD_INK
        ),
        "stylebar_mid": ParagraphStyle(
            "sbm", base, fontName="Helvetica-Bold", fontSize=11, alignment=1, textColor=HEAD_INK
        ),
        "stylebar_right": ParagraphStyle(
            "sbr", base, fontName="Helvetica-Bold", fontSize=11, alignment=2, textColor=HEAD_INK
        ),
        "status": ParagraphStyle(
            "st", base, fontName="Helvetica-Bold", fontSize=8, alignment=1, textColor=MUTED
        ),
        "head": ParagraphStyle(
            "h", base, fontName="Helvetica-Bold", fontSize=6.2, alignment=1, textColor=HEAD_INK
        ),
        "pom": ParagraphStyle("p", base, fontName="Helvetica-Bold", fontSize=6.2, leading=8),
        "desc": ParagraphStyle("d", base, fontSize=6.2, leading=8),
        "cell": ParagraphStyle("c", base, fontSize=6.4, leading=8, alignment=1),
        "note": ParagraphStyle("n", base, fontName="Helvetica-Oblique", fontSize=6.5, leading=9),
        "footer": ParagraphStyle(
            "f", base, fontName="Helvetica-Oblique", fontSize=6, textColor=MUTED
        ),
    }


def _cell_ink(row) -> str:
    """Colour for a reading: orange out of tolerance, blue when poorly heard.

    Out of tolerance wins when a value is both, because that is the finding a
    vendor has to act on; the confidence figure underneath still shows the doubt.
    """
    if row.is_fail:
        return FAIL_HEX
    if row.confidence < CONFIDENCE_FLOOR:
        return LOW_CONFIDENCE_HEX
    return INK_HEX


def _cell_text(row, pom_row=None, size: str = "") -> str:
    """Measured value, its deviation, and how confidently it was transcribed.

    A size nobody measured falls back to the style set's own specification, in
    grey and labelled "spec". Showing the sheet's number keeps the column
    readable; the label and the colour are what stop it being mistaken for
    something the inspector actually measured.
    """
    if row is None:
        spec = pom_row.spec_for(size) if pom_row is not None else None
        if spec is None or spec == 0:
            return f'<font color="{MISSING_HEX}">{BLANK}</font>'
        return (
            f'<font color="{MISSING_HEX}">{fmt(spec)}</font><br/>'
            f'<font size="4.5" color="{MISSING_HEX}">spec</font>'
        )

    ink = _cell_ink(row)
    measured = fmt(row.measured) if row.measured is not None else "?"
    lines = [f'<font color="{ink}">{measured}</font>']

    if row.deviation is not None:
        stated = "ok" if row.deviation == 0 else fmt(row.deviation, signed=True)
        lines.append(f'<font size="5" color="{ink}">{stated}</font>')

    confidence_ink = LOW_CONFIDENCE_HEX if row.confidence < CONFIDENCE_FLOOR else MUTED_HEX
    lines.append(f'<font size="4.5" color="{confidence_ink}">{row.confidence:.0%}</font>')
    return "<br/>".join(lines)


def _measurement_table(
    alignment: Alignment, style: StyleSet, css: dict[str, ParagraphStyle]
) -> Table:
    # Every size on the sheet, in sheet order — not just the ones dictated. A
    # size the inspector skipped is a fact the report has to show, and dropping
    # its column silently would hide that XS and XXL were never measured.
    sizes = list(style.sizes)
    measured_sizes = set(alignment.sizes)
    size_width = max(
        (PAGE_WIDTH - POM_WIDTH - DESCRIPTION_WIDTH - 2 * TOLERANCE_WIDTH) / max(len(sizes), 1),
        MIN_SIZE_WIDTH,
    )

    header = [
        "POM",
        "Description",
        "Tol-",
        "Tol+",
        *[size if size in measured_sizes else f"{size} *" for size in sizes],
    ]
    data: list[list[object]] = [[Paragraph(text, css["head"]) for text in header]]

    style_commands = [
        ("GRID", (0, 0), (-1, -1), 0.3, RULE),
        ("BACKGROUND", (0, 0), (-1, 0), HEAD_BG),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]
    for position, size in enumerate(sizes):
        column = 4 + position
        if size == style.base_size:
            # Triburg highlight the base size in yellow; keeping that makes the
            # report scan the same way as the sheet it is checked against.
            style_commands.append(("BACKGROUND", (column, 1), (column, -1), BASE_SIZE_BG))
            style_commands.append(("BACKGROUND", (column, 0), (column, 0), BASE_SIZE_HEAD))
        elif size not in measured_sizes:
            # Shade the columns nobody measured, so an empty column reads as
            # "not done" rather than "nothing found".
            style_commands.append(("BACKGROUND", (column, 1), (column, -1), NOT_MEASURED_BG))

    for index, pom_row in enumerate(style.spoken_rows(), start=1):
        cells = [
            Paragraph(pom_row.pom, css["pom"]),
            Paragraph(pom_row.description, css["desc"]),
            Paragraph(fmt(pom_row.tolerance_minus or 0, signed=True), css["cell"]),
            Paragraph(fmt(pom_row.tolerance_plus or 0, signed=True), css["cell"]),
        ]
        for size in sizes:
            result = alignment.result_at(index - 1, size)
            cells.append(Paragraph(_cell_text(result, pom_row, size), css["cell"]))
            if result is not None and result.is_fail:
                column = 4 + sizes.index(size)
                style_commands.append(("BACKGROUND", (column, index), (column, index), FAIL_BG))
        data.append(cells)
        if index % 2 == 0:
            style_commands.append(("BACKGROUND", (0, index), (3, index), BAND))

    widths = [POM_WIDTH, DESCRIPTION_WIDTH, TOLERANCE_WIDTH, TOLERANCE_WIDTH]
    widths += [size_width] * len(sizes)

    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle(style_commands))
    return table


def _image(data: bytes | None, height: float) -> Image | str:
    """A right-sized Image flowable, or an empty cell when the artwork is absent."""
    if not data:
        return ""
    reader = ImageReader(BytesIO(data))
    width, tall = reader.getSize()
    return Image(BytesIO(data), width=height * width / tall, height=height)


def _labelled(label: str, value: str, css: dict[str, ParagraphStyle]) -> list[object]:
    return [Paragraph(f"<b>{label}</b>", css["label"]), Paragraph(value or BLANK, css["meta"])]


def _title_bar(style: StyleSet, css: dict[str, ParagraphStyle]) -> Table:
    """The navy STYLE bar, with the garment sketch left and the eagle right."""
    art = style.artwork
    sketch_width = 20 * mm if art.sketch else 0
    eagle_width = 18 * mm if art.eagle else 0

    cells: list[object] = []
    widths: list[float] = []
    if art.sketch:
        cells.append(_image(art.sketch, 17 * mm))
        widths.append(sketch_width)

    text_width = PAGE_WIDTH - sketch_width - eagle_width
    first = len(cells)
    cells += [
        Paragraph(f"STYLE: {style.style_no}", css["stylebar"]),
        Paragraph(style.description, css["stylebar_mid"]),
        Paragraph(style.season, css["stylebar_right"]),
    ]
    widths += [text_width * 0.22, text_width * 0.56, text_width * 0.22]

    if art.eagle:
        cells.append(_image(art.eagle, 9 * mm))
        widths.append(eagle_width)

    bar = Table([cells], colWidths=widths, rowHeights=[19 * mm], hAlign="LEFT")
    bar.setStyle(
        TableStyle(
            [
                # Only the text spans carry the navy; the artwork sits on white,
                # the way the style sets print it.
                ("BACKGROUND", (first, 0), (first + 2, 0), HEAD_BG),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTRE"),
                ("BOX", (0, 0), (-1, -1), 0.5, RULE),
                ("LEFTPADDING", (first, 0), (first + 2, 0), 6),
                ("RIGHTPADDING", (first, 0), (first + 2, 0), 6),
            ]
        )
    )
    return bar


def _meta_block(alignment: Alignment, style: StyleSet, css: dict[str, ParagraphStyle]) -> Table:
    """The four-by-two metadata grid Triburg print under the banner."""
    rows = [
        _labelled("Company:", style.company, css)
        + _labelled("Tolerance Model:", style.tolerance_model, css)
        + _labelled("Size Range:", ", ".join(style.sizes), css),
        _labelled("Division / Dept:", style.division, css)
        + _labelled("POM Descr:", style.pom_descr, css)
        + _labelled("Base Size:", style.base_size, css),
        _labelled("Season:", style.season, css)
        + _labelled("Modified By:", style.modified_by, css)
        + _labelled("Sizes Measured:", ", ".join(alignment.sizes), css),
        _labelled("Style Desc:", style.description, css)
        + _labelled("Status:", style.status, css)
        + _labelled(
            "Measurement Result:",
            f"{alignment.verdict or BLANK} "
            f"({len(alignment.failures)} of {len(alignment.judged)} out of tolerance)",
            css,
        ),
    ]
    label_width = 26 * mm
    value_width = (PAGE_WIDTH - 3 * label_width) / 3
    table = Table(rows, colWidths=[label_width, value_width] * 3, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 1.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
                ("BOX", (0, 0), (-1, -1), 0.5, RULE),
            ]
        )
    )
    return table


def save_graded_pdf(alignment: Alignment, style: StyleSet, path: Path, source: str = "") -> Path:
    """Render the inspection as a graded measurements sheet."""
    path.parent.mkdir(parents=True, exist_ok=True)
    css = _styles()
    document = SimpleDocTemplate(
        str(path),
        pagesize=landscape(A4),
        title=f"Size Set Measurements {style.style_no}".strip(),
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
    )

    banner = Table(
        [[Paragraph("GRADE MEASUREMENTS - SIZE SET INSPECTION RESULT", css["banner"])]],
        colWidths=[PAGE_WIDTH],
        hAlign="LEFT",
    )
    banner.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), HEAD_BG),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )

    story: list[object] = [
        Paragraph(f"STATUS: {style.status or BLANK}", css["status"]),
        Spacer(1, 1.5 * mm),
        _title_bar(style, css),
        banner,
        _meta_block(alignment, style, css),
        Spacer(1, 3 * mm),
        _measurement_table(alignment, style, css),
        Spacer(1, 2 * mm),
        Paragraph(
            f"Each cell shows the measured value, its deviation, and how confidently it "
            f"was transcribed. &nbsp;"
            f'<font color="{FAIL_HEX}"><b>Orange</b> = outside tolerance.</font> &nbsp;'
            f'<font color="{LOW_CONFIDENCE_HEX}"><b>Blue</b> = heard with under '
            f"{CONFIDENCE_FLOOR:.0%} confidence, so confirm against the recording.</font> "
            f'&nbsp; <font color="{MISSING_HEX}"><b>Grey</b> = the style set\'s own '
            f"specification, shown for a size marked * that this inspection did not "
            f"measure. Those are not readings.</font>",
            css["note"],
        ),
        Spacer(1, 3 * mm),
    ]

    if alignment.failures:
        story.append(Paragraph("OUT OF TOLERANCE", css["meta"]))
        for row in alignment.failures:
            story.append(
                Paragraph(
                    f"{row.pom} {row.description} &mdash; size {row.size}: measured "
                    f"{fmt(row.measured)} against {fmt(row.spec)}, "
                    f"{fmt(row.deviation, signed=True)}",
                    css["note"],
                )
            )
        story.append(Spacer(1, 2 * mm))

    if alignment.unmatched:
        story.append(
            Paragraph(
                f"{len(alignment.unmatched)} spoken measurements could not be matched to a "
                "point of measure and are listed in the CSV.",
                css["note"],
            )
        )

    story.append(Spacer(1, 3 * mm))
    story.append(
        Paragraph(
            f"Generated from {source or 'an audio recording'} and checked against "
            f"{style.source.name}. Every value must be confirmed before this report is "
            "sent to a vendor.",
            css["footer"],
        )
    )

    document.build(story)
    log.info("wrote %s", path)
    return path


def attach_to_report(report_pdf: Path, graded_pdf: Path) -> Path:
    """Bind the graded sheet into the main report, starting at page two.

    Page one stays the Size Set Inspection Report form. The graded measurements
    follow, then the remaining pages of the report — construction, bill of
    materials, shrinkage and marker — which the graded sheet does not cover.
    """
    if not report_pdf.is_file() or not graded_pdf.is_file():
        return report_pdf

    # Read both into memory first: the report is about to be overwritten, and a
    # lazy reader still holding it open would write a truncated file.
    report = PdfReader(BytesIO(report_pdf.read_bytes()))
    graded = PdfReader(BytesIO(graded_pdf.read_bytes()))

    writer = PdfWriter()
    writer.add_page(report.pages[0])
    for page in graded.pages:
        writer.add_page(page)
    for page in report.pages[1:]:
        writer.add_page(page)

    with report_pdf.open("wb") as handle:
        writer.write(handle)
    log.info(
        "bound %d graded page(s) into %s (now %d pages)",
        len(graded.pages),
        report_pdf.name,
        len(writer.pages),
    )
    return report_pdf


GRADED_COLUMNS = (
    "no",
    "size",
    "pom",
    "description",
    "spoken_as",
    "spec",
    "measured",
    "deviation",
    "tol_minus",
    "tol_plus",
    "verdict",
    "confidence",
    "note",
)


def save_graded_csv(alignment: Alignment, style: StyleSet, path: Path) -> Path:
    """One row per spoken measurement, with its POM, spec and verdict."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(GRADED_COLUMNS)
        for row in alignment.rows:
            verdict = (
                "unmatched"
                if not row.matched
                else "pass"
                if row.in_tolerance
                else "FAIL"
                if row.in_tolerance is False
                else "unjudged"
            )
            writer.writerow(
                [
                    row.number,
                    row.size,
                    row.pom,
                    row.description,
                    row.spoken,
                    fmt(row.spec) if row.spec is not None else "",
                    fmt(row.measured) if row.measured is not None else "",
                    fmt(row.deviation, signed=True) if row.deviation is not None else "",
                    fmt(row.tolerance_minus, signed=True)
                    if row.tolerance_minus is not None
                    else "",
                    fmt(row.tolerance_plus, signed=True) if row.tolerance_plus is not None else "",
                    verdict,
                    f"{row.confidence:.2f}",
                    row.note,
                ]
            )
    log.info("wrote %s (%d rows)", path, len(alignment.rows))
    return path
