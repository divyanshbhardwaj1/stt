"""The main pipeline: recording -> transcript -> LLM -> CSV and PDF.

The client's blank form is loaded first, because it defines both what the model
must extract and how the outputs are laid out. Each stage is callable on its own
so a rerun can skip the expensive parts: a transcript already on disk is reused,
and the outputs rebuild from the saved extraction without touching the API.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from services.config import Settings
from services.csv_filler import (
    FormTemplate,
    InspectionSheet,
    extract_inspection,
    load_json,
    load_template,
    measurements_path_for,
    save_form_csv,
    save_json,
    save_measurements_csv,
    save_pdf,
)
from services.transcript import save_transcript, transcribe_recording, transcript_path_for

log = logging.getLogger(__name__)

Progress = Callable[[str], None]

MAX_OUTPUT_VERSIONS = 1000


@dataclass(frozen=True)
class PipelineResult:
    """What one run produced, and where it landed."""

    name: str
    transcript_path: Path
    sheet: InspectionSheet
    form_csv_path: Path
    measurements_csv_path: Path
    pdf_path: Path
    json_path: Path

    @property
    def flagged_count(self) -> int:
        return len(self.sheet.flagged())


def _silent(_: str) -> None:
    """Default progress sink, so callers that do not care need not pass one."""


def load_form_template(settings: Settings) -> FormTemplate:
    """The client's blank report, which defines the strict output layout."""
    return load_template(settings.form_template_path)


def output_paths(name: str, settings: Settings) -> tuple[Path, Path, Path, Path]:
    """The four files one run produces, in write order."""
    form_csv = settings.output_dir / f"{name}.csv"
    return (
        form_csv,
        measurements_path_for(form_csv),
        settings.output_dir / f"{name}.pdf",
        settings.output_dir / f"{name}.json",
    )


def resolve_output_name(base: str, settings: Settings) -> str:
    """'Recording_20', then 'Recording_20(1)', 'Recording_20(2)'...

    A previous run's outputs are never overwritten, so a report that has already
    been reviewed or sent stays exactly as it was. All four files of a run share
    the same suffix, so a version stays together.
    """
    if not any(path.exists() for path in output_paths(base, settings)):
        return base
    # ponytail: linear scan. Fine for the handful of reruns one recording sees;
    # if a recording ever needs hundreds, bisect instead.
    for version in range(1, MAX_OUTPUT_VERSIONS):
        candidate = f"{base}({version})"
        if not any(path.exists() for path in output_paths(candidate, settings)):
            return candidate
    raise FileExistsError(
        f"{MAX_OUTPUT_VERSIONS} versions of {base} already exist in {settings.output_dir}"
    )


def transcribe_stage(
    recording: Path,
    settings: Settings,
    on_delta: Progress | None = None,
) -> Path:
    """Stage 1. Recording -> transcript saved under data/transcripts/."""
    text = transcribe_recording(recording, settings, on_delta=on_delta)
    return save_transcript(recording, text, settings)


def extract_stage(transcript: Path, settings: Settings, template: FormTemplate) -> InspectionSheet:
    """Stage 2. Transcript -> filled inspection sheet, via one LLM call."""
    return extract_inspection(transcript.read_text(encoding="utf-8"), settings, template)


def write_stage(
    sheet: InspectionSheet,
    name: str,
    settings: Settings,
    template: FormTemplate,
) -> tuple[Path, Path, Path, Path]:
    """Stage 3. Filled sheet -> form CSV, measurements CSV, PDF, and the saved JSON.

    The JSON is written first, deliberately. A CSV left open in Excel is locked on
    Windows, and an extraction that cost an API call must not be lost to that.
    Once the JSON is down, `rerender` can finish the job for free.
    """
    form_csv, measurements_csv, pdf, json_path = output_paths(name, settings)
    save_json(sheet, json_path)
    save_form_csv(sheet, template, form_csv)
    save_measurements_csv(sheet, measurements_csv)
    save_pdf(sheet, template, pdf, source=name)
    return form_csv, measurements_csv, pdf, json_path


def run(
    recording: Path,
    settings: Settings,
    retranscribe: bool = False,
    on_delta: Progress | None = None,
    announce: Progress | None = None,
) -> PipelineResult:
    """Run every stage for one recording."""
    announce = announce or _silent
    template = load_form_template(settings)

    transcript = transcript_path_for(recording, settings)
    if transcript.is_file() and not retranscribe:
        announce(f"reusing transcript {transcript.name}")
    else:
        announce(f"transcribing {recording.name}")
        transcript = transcribe_stage(recording, settings, on_delta=on_delta)

    announce(f"extracting with {settings.extract_model}")
    sheet = extract_stage(transcript, settings, template)

    name = resolve_output_name(recording.stem, settings)
    written = write_stage(sheet, name, settings, template)
    return PipelineResult(name, transcript, sheet, *written)


def rerender(name: str, settings: Settings) -> PipelineResult:
    """Rebuild the CSVs and PDF from a saved extraction. No API call.

    Writes over that same version rather than allocating a new one: this is the
    same extraction rendered again, not a new run.
    """
    saved = settings.output_dir / f"{name}.json"
    if not saved.is_file():
        raise FileNotFoundError(saved)
    template = load_form_template(settings)
    sheet = load_json(saved)
    written = write_stage(sheet, name, settings, template)
    return PipelineResult(name, transcript_path_for(saved, settings), sheet, *written)
