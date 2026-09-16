"""Reading a style set that arrived as a scan rather than an export.

Two of the eight sheets on hand carry no text layer at all. The parser refuses
those, and that refusal is right: every measurement on a report is rebuilt as
spec + deviation, so one misread spec makes every row on that sheet wrong at
once, quietly, in a document that goes to a vendor. Guessing is worse than
stopping.

So this is a last resort, reached only when there is no text to read, and it is
built to be checked rather than trusted:

  * The sheet checks itself. A graded spec sheet is graded - values step across
    the sizes, and most rows either hold constant or climb. A row that wanders
    up and down is a misread, and saying so costs nothing because the document
    supplies the evidence.
  * Anything read this way is marked. `StyleSet.from_scan` follows the sheet
    into the report, so a vendor-facing document never hides that its numbers
    came out of an image.
  * The read is cached beside the PDF and meant to be committed. Vision output
    is not deterministic, and two machines re-reading the same scan could
    otherwise grade the same style differently. One cached read is one answer.
"""

from __future__ import annotations

import base64
import io
import json
import logging
from fractions import Fraction
from pathlib import Path
from typing import Any

from services.measurements import parse

log = logging.getLogger(__name__)

# 3x. At 2x the fraction strokes on these sheets close up and "3/8" reads as
# "9/8"; past 3x the pages get large without reading any better.
RENDER_SCALE = 3

# The boxes above the table. Every one of these prints on the graded report, so
# leaving them out left blank fields on a vendor-facing document.
HEADER_FIELDS = (
    "style_no", "description", "season", "division", "company", "status",
    "base_size", "tolerance_model", "pom_descr", "modified_by",
)


class ScanError(RuntimeError):
    """A scanned sheet could not be read, said plainly enough to act on."""


def cache_path_for(path: Path) -> Path:
    """Where a scanned sheet's reading is kept - beside the sheet, on purpose."""
    return path.with_suffix(".ocr.json")


def _schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "style_no", "description", "season", "division", "company", "status",
            "base_size", "tolerance_model", "pom_descr", "modified_by", "sizes", "rows",
        ],
        "properties": {
            "style_no": {"type": "string", "description": "The STYLE number printed on the sheet."},
            "base_size": {
                "type": "string",
                "description": (
                    "The base size the sheet names, e.g. from 'Base Size : M'. "
                    "Empty string if it names none."
                ),
            },
            "description": {"type": "string"},
            "season": {"type": "string"},
            "division": {"type": "string"},
            "company": {"type": "string"},
            "status": {"type": "string"},
            "tolerance_model": {"type": "string"},
            "pom_descr": {"type": "string"},
            "modified_by": {"type": "string"},
            "sizes": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Size column headings, left to right, exactly as printed.",
            },
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["pom", "description", "tol_minus", "tol_plus", "values"],
                    "properties": {
                        "pom": {"type": "string"},
                        "description": {"type": "string"},
                        "tol_minus": {"type": "string"},
                        "tol_plus": {"type": "string"},
                        "values": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "One entry per size column, in the same order.",
                        },
                    },
                },
            },
        },
    }


PROMPT = """\
This is a scanned garment GRADE MEASUREMENTS sheet. Read the measurement table
exactly as printed. Do not compute, round, interpolate or tidy anything.

`style_no` is the STYLE number printed on the sheet, digits only.
`base_size` is the base size the sheet names, e.g. from "Base Size : M"; "" if
it names none.
The header boxes above the table, each verbatim and "" when the sheet does not
print it: description, season, division, company, status, tolerance_model
(e.g. "WW TOP L20"), pom_descr (e.g. "GRADED SPECIFICATION"), modified_by.

`sizes` is the size column headings, left to right.

One entry in `rows` per printed table row, top to bottom:
  pom          the code printed in the first column OF THAT SAME ROW, e.g.
               "1.01A", "4.22A", "0.00B". Read it off the row you are reading,
               never the row above or below: a code borrowed from a neighbour
               puts every measurement under the wrong point of measure. Use "*"
               only when that row genuinely prints no code.
  description  the Description column, verbatim
  tol_minus    the Tol- column, e.g. "-3/8" or "0"; "" if blank
  tol_plus     the Tol+ column, e.g. "3/8" or "0"; "" if blank
  values       one entry per size column, in the same order as `sizes`

Values are inches as whole numbers or mixed fractions: "22 1/8", "3/4", "0",
"11 1/2". Use "" for a genuinely blank cell. Include free-text rows - notes and
instructions printed between the measurements - with their code and description
and "" for every value, so the sheet keeps its original order.

If the page is rotated, read it in its correct orientation.
"""


def _pages(path: Path) -> list[str]:
    """Each page as a data URI, rendered large enough to read fractions."""
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:  # pragma: no cover - declared, so this is a broken env
        raise ScanError(f"reading a scanned sheet needs pypdfium2: {exc}") from exc

    try:
        document = pdfium.PdfDocument(str(path))
        urls = []
        for index in range(len(document)):
            buffer = io.BytesIO()
            document[index].render(scale=RENDER_SCALE).to_pil().save(buffer, format="PNG")
            urls.append(
                "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()
            )
        return urls
    except Exception as exc:  # noqa: BLE001 - pdfium raises a wide range of errors
        raise ScanError(f"could not render {path.name}: {exc}") from exc


def read_pages(path: Path, settings, client: Any | None = None) -> dict[str, Any]:
    """Read every page of a scanned sheet, cached beside it after the first time."""
    cached = cache_path_for(path)
    if cached.is_file():
        return json.loads(cached.read_text(encoding="utf-8"))

    if client is None:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)

    pages = _pages(path)
    log.info("reading %s as a scan: %d page(s) at %dx", path.name, len(pages), RENDER_SCALE)
    sizes: list[str] = []
    header: dict[str, str] = {}
    rows: list[dict[str, Any]] = []
    for number, url in enumerate(pages, 1):
        response = client.responses.create(
            model=settings.extract_model,
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": PROMPT},
                        {"type": "input_image", "image_url": url},
                    ],
                }
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "grade_sheet",
                    "schema": _schema(),
                    "strict": True,
                }
            },
        )
        payload = json.loads(response.output_text)
        # The first page that names the columns wins; later pages repeat them.
        sizes = sizes or [str(s).strip() for s in payload.get("sizes", []) if str(s).strip()]
        # The header only prints on the first page; later pages repeat the
        # table. First non-empty answer wins.
        for name in HEADER_FIELDS:
            if not header.get(name):
                header[name] = str(payload.get(name, "")).strip()
        rows.extend(payload.get("rows", []))
        log.info("  page %d: %d rows", number, len(payload.get("rows", [])))

    if not rows:
        raise ScanError(f"{path.name} was rendered but no measurement table was found in it.")

    read = {"sizes": sizes, "rows": rows, **header}
    cached.write_text(json.dumps(read, indent=1, ensure_ascii=False), encoding="utf-8")
    log.info("cached the reading of %s at %s", path.name, cached.name)
    return read


def suspect_rows(rows, sizes: tuple[str, ...]) -> list[str]:
    """Rows whose graded values do not behave like a graded sheet.

    A size run holds constant or climbs; garments do not get smaller as the size
    goes up. A row that wanders is the signature of a misread digit - "28 3/4"
    coming back as "23 3/4" breaks the run where the true value would not.

    Reported, never corrected. The point is to tell a human which rows to look
    at, not to invent a value that looks tidier.
    """
    complaints = []
    for row in rows:
        # Zero is a blank on these sheets, not a measurement: reference rows
        # carry a value in the base size column and 0 everywhere else, and
        # reading that as a drop flagged a row the sheet prints correctly.
        values = [row.specs.get(size) for size in sizes]
        present = [v for v in values if v is not None and v != 0]
        if len(present) < 3:
            continue  # too few graded columns to say anything
        if all(v == present[0] for v in present):
            continue  # constant across sizes is normal and common
        drops = [
            (sizes[i], present[i - 1], present[i])
            for i in range(1, len(present))
            if present[i] < present[i - 1]
        ]
        if drops:
            where = ", ".join(f"{size} {_fmt(a)}->{_fmt(b)}" for size, a, b in drops[:3])
            complaints.append(f"{row.pom} {row.description[:38]}: {where}")
    return complaints


def _fmt(value: Fraction) -> str:
    from services.measurements import format_measurement

    return format_measurement(value)


def parsed_rows(read: dict[str, Any], sizes: tuple[str, ...]):
    """Turn a cached reading into PomRows."""
    from .spec_sheet import PomRow

    out = []
    for row in read.get("rows", []):
        values = list(row.get("values", []))
        specs = {
            size: parse(values[index]) if index < len(values) else None
            for index, size in enumerate(sizes)
        }
        out.append(
            PomRow(
                pom=str(row.get("pom", "")).strip() or "*",
                description=str(row.get("description", "")).strip(),
                tolerance_minus=parse(row.get("tol_minus", "")),
                tolerance_plus=parse(row.get("tol_plus", "")),
                specs=specs,
            )
        )
    return out
