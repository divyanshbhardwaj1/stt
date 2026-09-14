"""The main pipeline that turns an inspection recording into a filled report."""

from .inspection_pipeline import (
    PipelineResult,
    base_output_name,
    extract_stage,
    load_form_template,
    output_paths,
    rerender,
    resize_inspection,
    settle_inspection,
    resolve_output_name,
    run,
    run_from_transcript,
    transcribe_stage,
    validate_stage,
    write_stage,
)

__all__ = [
    "PipelineResult",
    "base_output_name",
    "extract_stage",
    "load_form_template",
    "output_paths",
    "rerender",
    "resize_inspection",
    "settle_inspection",
    "resolve_output_name",
    "run",
    "run_from_transcript",
    "transcribe_stage",
    "validate_stage",
    "write_stage",
]
