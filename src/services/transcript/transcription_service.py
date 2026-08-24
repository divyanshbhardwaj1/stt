"""Speech-to-text over size-set inspection recordings."""

from __future__ import annotations

import logging
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from openai import OpenAI

from services.config import Settings

from .audio_prep import AudioPrepError, compress_for_upload, compressed_name

log = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # hard API limit

# Steers the model on garment vocabulary and on Hindi fraction words, which it
# otherwise mangles into decimals ("1.38" for "one three-eight").
DOMAIN_PROMPT = (
    "Garment size-set inspection at a factory, mixed Hindi and English. "
    "The recording opens by announcing the style number being inspected, as digits. "
    "Terms: HPS, POM, placket, seersucker, shirring, neckband, armhole, bodice, "
    "hem, side seam tie, grading, nested nest, BOM, shrinkage, mini marker. "
    "Measurements are fractions of an inch spoken as 'one by eight', 'three by four', "
    "'quarter', 'सवा', 'पौने', 'साढ़े'. Transcribe numbers verbatim; do not translate."
)


class TranscriptionError(RuntimeError):
    """The recording could not be transcribed."""


def transcribe_recording(
    recording: Path,
    settings: Settings,
    client: Any | None = None,
    on_delta: Callable[[str], None] | None = None,
    announce: Callable[[str], None] | None = None,
) -> str:
    """Transcribe one recording, streaming partial text to `on_delta` as it arrives.

    A recording over the API's size limit is re-encoded to speech quality first,
    into a temporary file that is discarded afterwards; the original is never
    modified.

    Raises TranscriptionError if the recording still will not fit, or if the
    stream ends without a final transcript.
    """
    client = client or OpenAI(api_key=settings.openai_api_key)

    with tempfile.TemporaryDirectory(prefix="sizeset-") as scratch:
        upload = _fit_for_upload(recording, Path(scratch), announce=announce)
        log.info(
            "transcribing %s (%.1f MB) with %s",
            upload.name,
            upload.stat().st_size / 1e6,
            settings.transcribe_model,
        )

        text = ""
        with upload.open("rb") as handle:
            stream = client.audio.transcriptions.create(
                model=settings.transcribe_model,
                file=handle,
                prompt=DOMAIN_PROMPT,
                stream=True,
            )
            for event in stream:
                if event.type == "transcript.text.delta":
                    if on_delta:
                        on_delta(event.delta)
                elif event.type == "transcript.text.done":
                    text = event.text

    if not text:
        raise TranscriptionError(f"{recording.name}: stream ended without a final transcript.")
    return text


def _fit_for_upload(
    recording: Path, scratch: Path, announce: Callable[[str], None] | None = None
) -> Path:
    """The file to upload: the original, or a compact re-encode of it."""
    size = recording.stat().st_size
    if size <= MAX_UPLOAD_BYTES:
        return recording

    megabytes = size / 1e6
    if announce:
        announce(f"re-encoding {recording.name} ({megabytes:.0f} MB) to fit the upload limit")
    try:
        compressed = compress_for_upload(recording, scratch / compressed_name(recording))
    except AudioPrepError as exc:
        raise TranscriptionError(
            f"{recording.name} is {megabytes:.1f} MB, over the "
            f"{MAX_UPLOAD_BYTES / 1e6:.0f} MB API limit, and could not be re-encoded: {exc}"
        ) from exc

    if compressed.stat().st_size > MAX_UPLOAD_BYTES:
        # ponytail: one re-encode, no chunking. A recording still too big at
        # 16 kHz mono is many hours long; split it when that actually happens.
        raise TranscriptionError(
            f"{recording.name} is still {compressed.stat().st_size / 1e6:.1f} MB after "
            f"re-encoding, over the {MAX_UPLOAD_BYTES / 1e6:.0f} MB API limit. "
            "Split the recording into shorter parts."
        )
    return compressed
