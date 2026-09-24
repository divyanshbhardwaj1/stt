"""Finding the right style set for a recording.

Triburg run three to four thousand styles, so the sheet is chosen by the style
number the inspector announces at the start of the recording.
"""

from __future__ import annotations

import logging
import re
from functools import cache
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


@cache
def _parsed(path: Path, fingerprint: tuple[int, int]) -> StyleSet | None:
    """One sheet, parsed once.

    Keyed on the file's size and modification time as well as its path, so a
    replaced sheet is re-read and a cached one is never stale. `None` for a
    sheet that will not parse - the library screen lists it as unreadable
    rather than omitting it, because a sheet nobody can see is a sheet nobody
    fixes.
    """
    del fingerprint  # part of the cache key, not the work
    try:
        return read_style_set(path, None)
    except SpecSheetError as exc:
        log.warning("%s could not be read: %s", path.name, exc)
        return None


def read_library(directory: Path) -> list[tuple[Path, StyleSet | None]]:
    """Every sheet in `directory`, parsed, newest-first by style number.

    ponytail: parses each file once and caches on (path, size, mtime). Triburg
    run three to four thousand styles, so the first call on a cold process pays
    for all of them - fine at the few dozen a unit actually keeps on hand, and
    the point at which it stops being fine is the point to put this index in
    the database rather than in a dict.
    """
    out = []
    for path in style_set_files(directory):
        stat = path.stat()
        out.append((path, _parsed(path, (stat.st_size, stat.st_mtime_ns))))
    return out


def find_style_set(style_no: str, directory: Path, settings=None) -> StyleSet:
    """Load the style set for `style_no`.

    Matched on the filename first, which is cheap, then confirmed against the
    STYLE field inside the PDF. A mismatch is reported rather than accepted: the
    wrong spec sheet would silently validate every measurement against the wrong
    numbers.

    `settings` only matters when every candidate is a scan. A generated PDF is
    exact and an image has to be read, so a text layer always wins - for style
    9662 that is the difference between using the clean re-export beside the
    scan and reading the scan itself.
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

    # Two passes: every candidate on its text layer, and only then - if none of
    # them had one - as an image. Reading a scan when a clean export sits beside
    # it would trade an exact sheet for a read one.
    errors: list[str] = []
    for scan_allowed in (None, settings):
        for path in candidates:
            try:
                style = read_style_set(path, scan_allowed)
            except SpecSheetError as exc:
                errors.append(str(exc))
                continue
            if style.style_no and style.style_no != wanted:
                errors.append(
                    f"{path.name} is named for {wanted} but contains style {style.style_no}"
                )
                continue
            if style.from_scan:
                log.warning(
                    "style %s was read from an image; no text-layer export was available",
                    wanted,
                )
            return style
        if settings is None:
            break  # nothing else to try

    raise StyleSetNotFound(f"style set for {wanted} could not be used: " + "; ".join(errors))
