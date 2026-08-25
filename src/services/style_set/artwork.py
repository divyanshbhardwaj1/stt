"""Pulls the artwork out of a style set so the report can carry it too.

Triburg's sheets embed three images: the garment sketch (different per style),
the AEO eagle, and an "APPROVED FOR PRODUCTION" watermark. Reusing the client's
own artwork is what makes the generated report read as the same document rather
than a lookalike drawn from scratch.

Nothing here is essential: a sheet with no usable images still produces a
report, just without the pictures.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader

log = logging.getLogger(__name__)

# The eagle and watermark are byte-identical across styles at these pixel sizes;
# the sketch is whatever else the page carries.
EAGLE_SIZE = (154, 137)
WATERMARK_WIDEST = 618  # the watermark is wide and short
MIN_SKETCH_PIXELS = 20_000


@dataclass(frozen=True)
class Artwork:
    """Images lifted from a style set, as PNG bytes."""

    sketch: bytes | None = None
    eagle: bytes | None = None

    def __bool__(self) -> bool:
        return bool(self.sketch or self.eagle)


def read_artwork(path: Path) -> Artwork:
    """Extract the garment sketch and the AEO eagle from a style set PDF."""
    try:
        from PIL import Image

        page = PdfReader(str(path)).pages[0]
        images = [(image.name, Image.open(io.BytesIO(image.data))) for image in page.images]
    except Exception as exc:  # noqa: BLE001 - artwork is decoration, never a blocker
        log.info("no artwork from %s: %s", path.name, exc)
        return Artwork()

    sketch = eagle = None
    for _, image in images:
        if image.size == EAGLE_SIZE:
            eagle = image
        elif image.width >= WATERMARK_WIDEST:
            continue  # the diagonal "APPROVED FOR PRODUCTION" wash
        elif image.width * image.height >= MIN_SKETCH_PIXELS and sketch is None:
            sketch = image

    return Artwork(sketch=_as_png(sketch), eagle=_as_png(eagle))


def _as_png(image) -> bytes | None:
    if image is None:
        return None
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="PNG")
    return buffer.getvalue()
