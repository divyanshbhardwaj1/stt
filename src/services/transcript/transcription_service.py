"""Speech-to-text over size-set inspection recordings."""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

from openai import OpenAI

from services.config import Settings

log = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # hard API limit

# Steers the model on garment vocabulary and on Hindi fraction words, which it
# otherwise mangles into decimals ("1.38" for "one three-eight").
DOMAIN_PROMPT = (
    "Garment size-set inspection at a factory, mixed Hindi and English. "
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
) -> str:
    """Transcribe one recording, streaming partial text to `on_delta` as it arrives.

    Raises TranscriptionError if the file exceeds the API upload limit or if the
    stream ends without a final transcript.
    """
    # ponytail: 25 MB cap. Chunk with ffmpeg/pydub when a recording first exceeds it.
    size = recording.stat().st_size
    if size > MAX_UPLOAD_BYTES:
        raise TranscriptionError(
            f"{recording.name} is {size / 1e6:.1f} MB, over the "
            f"{MAX_UPLOAD_BYTES / 1e6:.0f} MB API limit. Split or re-encode it first."
        )

    client = client or OpenAI(api_key=settings.openai_api_key)
    log.info(
        "transcribing %s (%.1f MB) with %s",
        recording.name,
        size / 1e6,
        settings.transcribe_model,
    )

    text = ""
    with recording.open("rb") as handle:
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
