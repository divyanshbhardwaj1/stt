"""Saves a filled inspection as CSV, in the client's own form layout.

The main CSV mirrors the form cell for cell, so it opens in Excel looking like
the paper report. Measurement detail belongs on the attached spec sheet, so it
goes to a companion `<name>-measurements.csv` rather than being squeezed in.
"""

from __future__ import annotations

import csv
import json
import logging
from pathlib import Path

from .form_filler import fill_form
from .inspection_record import ROW_COLUMNS, InspectionSheet
from .report_template import FormTemplate

log = logging.getLogger(__name__)

MEASUREMENT_SUFFIX = "-measurements"


def save_form_csv(sheet: InspectionSheet, template: FormTemplate, path: Path) -> Path:
    """Write the filled form, one CSV cell per form cell."""
    grid = fill_form(sheet, template)
    path.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig so Excel on Windows renders the Hindi in comments correctly.
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        csv.writer(handle).writerows(grid)
    log.info("wrote %s (%d form rows)", path, len(grid))
    return path


def save_measurements_csv(sheet: InspectionSheet, path: Path) -> Path:
    """Write the measurement detail: one row per point of measure, plus a review column."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["no", *ROW_COLUMNS, "needs_review"])
        for number, row in sheet.numbered():
            writer.writerow(
                [
                    number,
                    row.section,
                    row.size,
                    row.field,
                    row.value,
                    row.deviation,
                    row.note,
                    f"{row.confidence:.2f}",
                    "yes" if row.needs_review else "",
                ]
            )
    log.info("wrote %s (%d rows)", path, len(sheet.rows))
    return path


def measurements_path_for(form_csv: Path) -> Path:
    return form_csv.with_name(f"{form_csv.stem}{MEASUREMENT_SUFFIX}{form_csv.suffix}")


def save_json(sheet: InspectionSheet, path: Path) -> Path:
    """Save the raw extraction so the outputs can be rebuilt without another API call."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(sheet.to_payload(), indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def load_json(path: Path) -> InspectionSheet:
    """Read back a sheet saved by save_json."""
    return InspectionSheet.from_payload(json.loads(path.read_text(encoding="utf-8")))
