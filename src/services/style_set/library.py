"""Finding the right style set for a recording.

Triburg run three to four thousand styles, so the sheet is chosen by the style
number the inspector announces at the start of the recording.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from .spec_sheet import SpecSheetError, StyleSet, read_style_set

log = logging.getLogger(__name__)

DIGITS = re.compile(r"\d+")


class StyleSetNotFound(RuntimeError):
    """No style set on disk matches the style number announced in the recording."""


def style_set_files(directory: Path) -> list[Path]:
    """Every style set PDF in `directory`, sorted by name."""
    if not directory.is_dir():
        return []
    return sorted(path for path in directory.iterdir() if path.suffix.lower() == ".pdf")


def _numbers_in(name: str) -> set[str]:
    return set(DIGITS.findall(name))


def list_style_numbers(directory: Path) -> list[str]:
    """Every style number with a sheet on disk, sorted.

    Read from filenames rather than by opening each PDF: Triburg run three to
    four thousand styles, and parsing all of them to populate a dropdown would
    make the page unusable.

    ponytail: filename only. If descriptions are ever wanted in the list, build
    an index keyed by path and mtime rather than parsing on every request.
    """
    numbers = set()
    for path in style_set_files(directory):
        numbers.update(_numbers_in(path.stem))
    return sorted(numbers)


def find_style_set(style_no: str, directory: Path) -> StyleSet:
    """Load the style set for `style_no`.

    Matched on the filename first, which is cheap, then confirmed against the
    STYLE field inside the PDF. A mismatch is reported rather than accepted: the
    wrong spec sheet would silently validate every measurement against the wrong
    numbers.
    """
    wanted = style_no.strip()
    if not wanted:
        raise StyleSetNotFound(
            "the recording did not announce a style number, so no style set can be chosen"
        )

    available = style_set_files(directory)
    if not available:
        raise StyleSetNotFound(f"no style set PDFs in {directory}")

    candidates = [path for path in available if wanted in _numbers_in(path.stem)]
    if not candidates:
        raise StyleSetNotFound(
            f"no style set for style {wanted} in {directory}. "
            f"Available: {', '.join(path.stem for path in available)}"
        )

    errors = []
    for path in candidates:
        try:
            style = read_style_set(path)
        except SpecSheetError as exc:
            errors.append(str(exc))
            continue
        if style.style_no and style.style_no != wanted:
            errors.append(f"{path.name} is named for {wanted} but contains style {style.style_no}")
            continue
        return style

    raise StyleSetNotFound(f"style set for {wanted} could not be used: " + "; ".join(errors))
