"""Builds stand-in Triburg style set PDFs for the tests.

The client's real sheets are confidential and gitignored, so CI never sees them.

Triburg's system emits two layouts and the client cannot choose which they get:
one line per row, and one line per table cell. Both are generated here from the
same `ROWS` table, so the two can never describe different sheets — a parser that
handles one but not the other fails the tests rather than passing quietly.
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas

SIZES = ("XXS", "XS", "S", "M", "L", "XL", "XXL")

# (POM, description, tol-, tol+, one value per size). Includes the awkward cases
# the parser must survive: a '*' note, a zero-tolerance reference row, fractions
# written with a space, and a description long enough to wrap.
ROWS = (
    ("*", "A FREE TEXT NOTE FROM DEVELOPMENT", "0", "0", ("0",) * 7),
    ("0.00A", "DISCLAIMER (KNIT): MEASURE GMTS IN WIDTH", "0", "0", ("0",) * 7),
    (
        "1.01C",
        "FRONT LENGTH FROM HPS - NK SEAM",
        "-5/8",
        "5/8",
        ("30 1/2", "31 1/4", "32", "32 3/4", "34", "35 1/4", "36 1/2"),
    ),
    ("2.01A", "SHOULDER SEAM FORWARD", "-1/8", "1/8", ("1/2",) * 7),
    (
        "1.20A",
        "ACROSS SHOULDER SEAM TO SEAM ** TOL UPDATED",
        "-3/8",
        "3/8",
        ("12 1/4", "12 3/4", "13 1/4", "13 3/4", "14 1/2", "15 1/4", "16"),
    ),
    (
        "1.28A",
        "CHEST WIDTH @ AH",
        "-3/8",
        "3/8",
        ("13 1/4", "14 1/4", "15 1/4", "16 1/4", "17 3/4", "19 1/4", "21 1/4"),
    ),
    (
        "1.30A",
        "WAIST STRAIGHT",
        "-3/8",
        "3/8",
        ("12", "13", "14", "15", "16 1/2", "18", "20"),
    ),
)

# The POM whose description is split across lines in the row layout, mirroring
# how Triburg's exports wrap long text.
WRAPPED_POM = "1.20A"

# The row after this index sits on a page break, so the next page's header lands
# on the end of it. Index 3 is 2.01A, whose values must survive.
PAGE_BREAK_AFTER = 3

EXPECTED_BASE_SIZE_SPECS = {
    pom: values[SIZES.index("M")] for pom, _, _, _, values in ROWS if pom != "*"
}
MEASURED_POMS = ("1.01C", "2.01A", "1.20A", "1.28A", "1.30A")

PREAMBLE = (
    "STATUS: FNL",
    "STYLE: 9999 9999 TEST GARMENT SS 2026",
    "Company: TEST COMPANY",
    "Division / Dept: 01 / 001",
    "Season: SS 2026",
    "Style Desc: 9999 TEST GARMENT",
    "Fit / Other:",
    "GRADE MEASUREMENTS - APPROVED FOR PRODUCTION - TRIBURG CONSULTANTS PVT LTD.",
    "POM Descr : Grade Specifications Worksheet Base Size : M",
    "Modified By : TESTER Modified Date/Time : 2026-04-15 16:00:31",
)
FOOTER = "Date Printed: 15/Apr/2026 Page 1 of"


def row_layout_lines() -> list[str]:
    """One line per row, the layout most Triburg exports use."""
    lines = [*PREAMBLE, f"POM Description Tol- Tol+ {' '.join(SIZES)}"]
    for index, (pom, description, minus, plus, values) in enumerate(ROWS):
        numbers = f"{minus} {plus} {' '.join(values)}"
        if pom == WRAPPED_POM:
            head, tail = description.rsplit(" ", 1)
            lines += [f"{pom} {head}", tail, numbers]
        else:
            lines.append(f"{pom} {description} {numbers}")
        # Mid-sheet, drop in the header every page repeats — extraction runs it
        # straight onto the end of the row above, which used to make that row
        # read "Incremental / IN" as its measurements.
        if index == PAGE_BREAK_AFTER:
            lines[-1] += " STATUS: FNL STYLE: 9999 9999 TEST GARMENT SS 2026"
            lines += [*PREAMBLE[2:], f"POM Description Tol- Tol+ {' '.join(SIZES)}"]
    lines.append(FOOTER)
    return lines


def cell_layout_lines() -> list[str]:
    """One line per table cell, the layout style_9662_clean.pdf arrived in."""
    lines = [
        FOOTER,
        "Page 1",
        "STYLE: 9999",
        " STATUS: FNL",
        "Company:",
        "TEST COMPANY",
        "Division / Dept:",
        "01 / 001",
        "Season:",
        "SS 2026",
        "Style Desc:",
        "9999 TEST GARMENT",
        "Base Size:",
        "M",
        " POM",
        " Description",
        " Tol-",
        " Tol+",
        *[f" {size}" for size in SIZES],
    ]
    for pom, description, minus, plus, values in ROWS:
        lines += [pom, description, f" {minus}", f" {plus}"]
        lines += [f" {value}" for value in values]
    return lines


def _write(path: Path, lines: list[str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    page = canvas.Canvas(str(path), pagesize=landscape(A4))
    page.setFont("Helvetica", 8)
    y = landscape(A4)[1] - 40
    for line in lines:
        page.drawString(30, y, line)
        y -= 12
    page.save()
    return path


DEFAULT_STYLE_NO = "9999"


def write_style_set(
    path: Path, lines: list[str] | None = None, style_no: str = DEFAULT_STYLE_NO
) -> Path:
    """Write a stand-in style set in the one-line-per-row layout.

    `style_no` lets a test produce a sheet for a particular style, which is what
    the style number announced in a recording has to match.
    """
    chosen = lines if lines is not None else row_layout_lines()
    if style_no != DEFAULT_STYLE_NO:
        chosen = [line.replace(DEFAULT_STYLE_NO, style_no) for line in chosen]
    return _write(path, chosen)


def write_cell_layout_style_set(path: Path) -> Path:
    """Write the same sheet in the one-line-per-cell layout."""
    return _write(path, cell_layout_lines())


def write_scanned_style_set(path: Path) -> Path:
    """Write a PDF with no text layer, standing in for a scanned sheet."""
    path.parent.mkdir(parents=True, exist_ok=True)
    page = canvas.Canvas(str(path), pagesize=landscape(A4))
    page.rect(40, 40, 300, 200, stroke=1, fill=0)  # geometry only, no text
    page.save()
    return path
