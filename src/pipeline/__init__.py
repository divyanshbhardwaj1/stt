"""The main pipeline that turns an inspection recording into a filled report."""

from .inspection_pipeline import (
    PipelineResult,
    extract_stage,
    load_form_template,
    output_paths,
    rerender,
    resolve_output_name,
    run,
    transcribe_stage,
    write_stage,
)

__all__ = [
    "PipelineResult",
    "extract_stage",
    "load_form_template",
    "output_paths",
    "rerender",
    "resolve_output_name",
    "run",
    "transcribe_stage",
    "write_stage",
]
