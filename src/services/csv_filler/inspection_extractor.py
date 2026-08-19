"""Fills the inspection sheet from a transcript, using one schema-enforced LLM call.

The client's form drives the schema: the model is told the exact accessory names
from the template so its answers land in real cells rather than free text.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from openai import OpenAI

from services.config import Settings

from .inspection_record import FORM_FIELDS, ROW_COLUMNS, SECTIONS, InspectionSheet
from .report_template import ACCESSORY_STATUSES, FormTemplate

log = logging.getLogger(__name__)


class ExtractionError(RuntimeError):
    """The transcript could not be turned into a filled sheet."""


def build_schema(accessory_items: list[str]) -> dict[str, Any]:
    """Strict structured-output schema. Every property is required; extras forbidden."""
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["form", "accessories", "comments", "rows"],
        "properties": {
            "form": {
                "type": "object",
                "additionalProperties": False,
                "required": list(FORM_FIELDS),
                "properties": {name: {"type": "string"} for name in FORM_FIELDS},
            },
            "accessories": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["item", "status", "note"],
                    "properties": {
                        "item": {"type": "string", "enum": accessory_items},
                        "status": {"type": "string", "enum": [*ACCESSORY_STATUSES, ""]},
                        "note": {
                            "type": "string",
                            "description": "Short qualifier printed as a footnote. '' if none.",
                        },
                    },
                },
            },
            "comments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["comment", "vendor_action"],
                    "properties": {
                        "comment": {"type": "string"},
                        "vendor_action": {"type": "string"},
                    },
                },
            },
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": list(ROW_COLUMNS),
                    "properties": {
                        "section": {"type": "string", "enum": list(SECTIONS)},
                        "size": {
                            "type": "string",
                            "description": "XXS, XS, S, M, L, XL or XXL. '' if not size-specific.",
                        },
                        "field": {
                            "type": "string",
                            "description": "Point of measure or item name, as spoken.",
                        },
                        "value": {
                            "type": "string",
                            "description": "Measured value as a canonical fraction, e.g. '22 1/8'.",
                        },
                        "deviation": {
                            "type": "string",
                            "description": "Signed deviation, e.g. '+1/8'. '' if not given.",
                        },
                        "note": {"type": "string", "description": "Any qualifier. '' if none."},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    },
                },
            },
        },
    }


BASE_INSTRUCTIONS = """\
You fill in a garment Size Set Inspection Report from a recording of the inspection.
The speech is mixed Hindi and English. An inspector reads a graded spec sheet aloud,
point of measure by point of measure, one size at a time, while an assistant calls out
the measured values, and comments on defects as they go.

Return four things.

`form` — the named boxes on the report. Use "" for anything the recording does not
state; never guess a date, a quantity or a result that was not said aloud.
  style_no, division, date, description, colour: from the opening discussion.
  grain_line, notches, graded_nest, corrections_implemented, yy_mini_marker: the
    pattern checklist, usually answered "ok".
  planned_submission_date, actual_submission_date, pcd, cut_quantity.
  size_set_inspection_result: Pass, Pass with comment, or Fail.
  shrinkage: the shell figures as stated, in the form "L = <pct>  W = <pct>".
  lining_shrinkage: the lining figures, if any were tested.
  shrinkage_note: how many samples were tested and whether that passes.
  measurement_result: PASS or FAIL CONDITIONALLY, for the measurement block.
  measurement_graded_nest: OK or Not OK.
  corrections_to_be_done: corrections named for the spec, separated by semicolons.
  bring_back_to_specs: measurements to be brought back to spec, if any were named.
  cutting_check, seam_allowance, checks_corrections_implemented: OK or Not OK.
  overall: the closing verdict, in the inspector's own words.

`accessories` — one entry per accessory the recording actually covers, using the
exact item names listed below. status is ACT when the item was checked and present,
MIS when missing, ALT when it needs altering, PLA for a placement issue, "" if
mentioned but with no verdict. Omit accessories that were never discussed. `note`
carries a short qualifier in the speaker's own words when one was raised; use ""
when the item passed without comment.

`comments` — the defects and instructions, in the order raised, each paired with the
action demanded of the vendor. Keep them short, the way they are written on the form.

`rows` — the measurement detail and supporting observations. Sections:
  measurement: a point of measure and its value for a specific size
  construction: an observation about how the garment is made
  bom: a component read from the bill of materials
  shrinkage: a tested shrinkage figure
  marker: mini marker facts (consumption, one-way/two-way, YY)
  comment: a defect or instruction

Rules for rows:
1. Normalise every number to a canonical fraction string. "one by eight" -> "1/8".
   "12 3 by 4" -> "12 3/4". "seventeen and a half" -> "17 1/2". "thirty-eight" -> "38".
   "सवा तेईस" -> "23 1/4". "साढ़े दस" -> "10 1/2". "पौने पाँच" -> "4 3/4".
   "डेढ़" -> "1 1/2". "ढाई" -> "2 1/2".
   Speech recognition sometimes writes a mixed number as a decimal: "1.38" means
   "1 3/8", "9.34" means "9 3/4". Convert those back.
2. Sizes are announced aloud ("Size large", "Size double extra small"). Attribute every
   following measurement to the size most recently announced, until the next one.
   Map to XXS, XS, S, M, L, XL, XXL. The first size discussed is usually the PP sample.
3. Deviations are spoken right after a value: "minus one by eight" -> "-1/8",
   "plus one by four" -> "+1/4". A bare "okay" means deviation "" (on spec).
4. Speakers correct themselves mid-sentence and re-confirm numbers. The last confirmed
   value wins. Put the disagreement in `note` and lower `confidence`.
5. Never invent a value. If a size is announced but no measurements follow, emit no rows
   for it. If you cannot hear a number, omit the row rather than guessing.
6. `confidence` is your genuine certainty that the row is correct: 1.0 for a clearly
   stated value, below 0.7 for anything ambiguous, garbled or reconstructed.
Keep `field` close to the words spoken so it can be matched against the spec sheet later.
"""


def build_instructions(accessory_items: list[str]) -> str:
    listed = "\n".join(f"  {item}" for item in accessory_items)
    return f"{BASE_INSTRUCTIONS}\nAccessory item names, use these exactly:\n{listed}\n"


def extract_inspection(
    transcript: str,
    settings: Settings,
    template: FormTemplate,
    client: Any | None = None,
) -> InspectionSheet:
    """Turn a transcript into a filled InspectionSheet. One API call, schema-enforced."""
    if not transcript.strip():
        raise ExtractionError("transcript is empty")

    accessory_items = [label for label, _, _ in template.accessory_items()]
    client = client or OpenAI(api_key=settings.openai_api_key)
    log.info("extracting %d chars with %s", len(transcript), settings.extract_model)

    response = client.responses.create(
        model=settings.extract_model,
        input=[
            {"role": "system", "content": build_instructions(accessory_items)},
            {"role": "user", "content": transcript},
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "size_set_inspection_report",
                "schema": build_schema(accessory_items),
                "strict": True,
            }
        },
    )

    try:
        payload = json.loads(response.output_text)
    except (AttributeError, ValueError) as exc:
        raise ExtractionError(f"model did not return usable JSON: {exc}") from exc

    sheet = InspectionSheet.from_payload(payload)
    if not sheet.rows and not sheet.comments:
        raise ExtractionError("model returned nothing to fill the form with")

    log.info(
        "extracted %d rows, %d accessories, %d comments (sizes %s, %d flagged)",
        len(sheet.rows),
        len(sheet.accessories),
        len(sheet.comments),
        ", ".join(sheet.sizes()) or "none",
        len(sheet.flagged()),
    )
    return sheet
