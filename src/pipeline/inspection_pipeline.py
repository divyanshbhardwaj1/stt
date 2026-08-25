"""The main pipeline: recording -> transcript -> LLM -> CSV and PDF.

The client's blank form is loaded first, because it defines both what the model
must extract and how the outputs are laid out. Each stage is callable on its own
so a rerun can skip the expensive parts: a transcript already on disk is reused,
and the outputs rebuild from the saved extraction without touching the API.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from services.config import Settings
from services.csv_filler import (
    FormTemplate,
    InspectionSheet,
    attach_to_report,
    extract_inspection,
    load_json,
    load_template,
    measurements_path_for,
    save_form_csv,
    save_graded_csv,
    save_graded_pdf,
    save_json,
    save_measurements_csv,
    save_pdf,
)
from services.style_set import (
    Alignment,
    SpecSheetError,
    StyleSet,
    StyleSetNotFound,
    align,
    find_style_set,
)
from services.transcript import save_transcript, transcribe_recording, transcript_path_for

log = logging.getLogger(__name__)

Progress = Callable[[str], None]

MAX_OUTPUT_VERSIONS = 1000

# A trailing "(3)" on an output name marks its version, not part of the name.
VERSION_SUFFIX = re.compile(r"\(\d+\)$")


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
    alignment: Alignment | None = None
    style: StyleSet | None = None

    @property
    def flagged_count(self) -> int:
        return len(self.sheet.flagged())

    @property
    def graded_paths(self) -> tuple[Path, Path] | None:
        """Where the graded report landed, if a style set was available."""
        if self.alignment is None:
            return None
        base = self.pdf_path.with_suffix("")
        return base.with_name(f"{base.name}-graded.csv"), base.with_name(f"{base.name}-graded.pdf")


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


def base_output_name(name: str) -> str:
    """'Recording_20(3)' -> 'Recording_20'.

    Versions are counted from the original name, so re-running something already
    versioned gives 'Recording_20(4)' rather than 'Recording_20(3)(1)'.
    """
    return VERSION_SUFFIX.sub("", name).strip()


def resolve_output_name(name: str, settings: Settings) -> str:
    """'Recording_20', then 'Recording_20(1)', 'Recording_20(2)'...

    A previous run's outputs are never overwritten, so a report that has already
    been reviewed or sent stays exactly as it was. All four files of a run share
    the same suffix, so a version stays together.
    """
    base = base_output_name(name)
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
    announce: Progress | None = None,
) -> Path:
    """Stage 1. Recording -> transcript saved under data/transcripts/."""
    text = transcribe_recording(recording, settings, on_delta=on_delta, announce=announce)
    return save_transcript(recording, text, settings)


def extract_stage(transcript: Path, settings: Settings, template: FormTemplate) -> InspectionSheet:
    """Stage 2. Transcript -> filled inspection sheet, via one LLM call."""
    return extract_inspection(transcript.read_text(encoding="utf-8"), settings, template)


def validate_stage(
    sheet: InspectionSheet, settings: Settings, style_no: str = ""
) -> tuple[Alignment, StyleSet] | None:
    """Stage 3. Match the spoken measurements to the style set and judge them.

    `style_no` is the style the operator chose when uploading. It wins over the
    number announced in the recording, which can be mis-heard — but a
    disagreement between the two is logged rather than swallowed, because it
    usually means the wrong recording was paired with the sheet.

    Returns None when the style set is unavailable: a missing or scanned sheet
    should cost the graded report, not the whole run.
    """
    announced = sheet.field("style_no")
    chosen = style_no.strip() or announced
    if style_no.strip() and announced and style_no.strip() != announced:
        log.warning(
            "style %s was chosen but the recording announces %s; using %s",
            style_no.strip(),
            announced,
            style_no.strip(),
        )

    try:
        style = find_style_set(chosen, settings.style_sets_dir)
    except (StyleSetNotFound, SpecSheetError) as exc:
        log.warning("no verdicts: %s", exc)
        return None
    return align(sheet, style), style


def write_stage(
    sheet: InspectionSheet,
    name: str,
    settings: Settings,
    template: FormTemplate,
    validated: tuple[Alignment, StyleSet] | None = None,
) -> tuple[Path, Path, Path, Path]:
    """Stage 4. Filled sheet -> form CSV, measurements CSV, PDF, and the saved JSON.

    The JSON is written first, deliberately. A CSV left open in Excel is locked on
    Windows, and an extraction that cost an API call must not be lost to that.
    Once the JSON is down, `rerender` can finish the job for free.
    """
    form_csv, measurements_csv, pdf, json_path = output_paths(name, settings)
    save_json(sheet, json_path)
    save_form_csv(sheet, template, form_csv)
    save_measurements_csv(sheet, measurements_csv)
    save_pdf(sheet, template, pdf, source=name)

    if validated:
        alignment, style = validated
        save_graded_csv(alignment, style, graded_csv_path(name, settings))
        graded = save_graded_pdf(alignment, style, graded_pdf_path(name, settings), source=name)
        # The graded sheet also ships standalone, for anyone who wants only the
        # measurements, but the report a vendor receives is the whole thing.
        attach_to_report(pdf, graded)
    return form_csv, measurements_csv, pdf, json_path


def graded_csv_path(name: str, settings: Settings) -> Path:
    return settings.output_dir / f"{name}-graded.csv"


def graded_pdf_path(name: str, settings: Settings) -> Path:
    return settings.output_dir / f"{name}-graded.pdf"


def run(
    recording: Path,
    settings: Settings,
    retranscribe: bool = False,
    on_delta: Progress | None = None,
    announce: Progress | None = None,
    style_no: str = "",
) -> PipelineResult:
    """Run every stage for one recording.

    `style_no` names the style set to check against, overriding whatever the
    recording announces.
    """
    announce = announce or _silent
    template = load_form_template(settings)

    transcript = transcript_path_for(recording, settings)
    if transcript.is_file() and not retranscribe:
        announce(f"reusing transcript {transcript.name}")
    else:
        announce(f"transcribing {recording.name}")
        transcript = transcribe_stage(recording, settings, on_delta=on_delta, announce=announce)

    announce(f"extracting with {settings.extract_model}")
    sheet = extract_stage(transcript, settings, template)

    announce(f"checking against style set {style_no}".rstrip())
    validated = validate_stage(sheet, settings, style_no)

    name = resolve_output_name(recording.stem, settings)
    written = write_stage(sheet, name, settings, template, validated)
    alignment, style = validated if validated else (None, None)
    return PipelineResult(name, transcript, sheet, *written, alignment=alignment, style=style)


def rerender(
    name: str, settings: Settings, new_version: bool = False, style_no: str = ""
) -> PipelineResult:
    """Rebuild the CSVs and PDF from a saved extraction. No API call.

    Writes over that same version by default, because this is the same extraction
    rendered again rather than a new run — handy while iterating on layout.
    Pass `new_version` to leave the existing files untouched and write the next
    version alongside them, which is what you want once a report has been shared.
    """
    saved = settings.output_dir / f"{name}.json"
    if not saved.is_file():
        raise FileNotFoundError(saved)
    template = load_form_template(settings)
    sheet = load_json(saved)
    validated = validate_stage(sheet, settings, style_no)
    if new_version:
        name = resolve_output_name(name, settings)
    written = write_stage(sheet, name, settings, template, validated)
    alignment, style = validated if validated else (None, None)
    return PipelineResult(
        name,
        transcript_path_for(saved, settings),
        sheet,
        *written,
        alignment=alignment,
        style=style,
    )
