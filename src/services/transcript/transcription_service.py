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

# Cut the audio into voice-activity chunks. Left unset the API transcribes the
# whole upload as ONE block, and a size-set inspection runs 30 to 60 minutes.
# Over that length short unstressed utterances go missing — the "okay" and
# "minus one by eight" after each measurement, which are the point of the
# recording. Chunking measurably fixed most of that on style 2463: deviation
# calls went from 13 "minus" to 23, spoken passes from 39 to 47-58.
#
# It did NOT make the result stable. The same audio still transcribes with
# 47 or 58 spoken passes depending on the run, and the shortfall lands in the
# same stretch of audio each time. Pinning the boundaries with an explicit
# server_vad config (threshold 0.3, silence 1200ms, padding 500ms) produced a
# byte-identical transcript to "auto", so these boundaries are not the lever and
# "auto" is kept as the simpler documented behaviour.
#
# ponytail: a lost verdict now surfaces as an open question rather than a false
# pass, so this fails safe. Closing the gap needs more than one pass over the
# audio, not a different parameter — see the consensus note in the README.
CHUNKING_STRATEGY = "auto"

# The inspection is dictated in Hindi and English within the same sentence, so
# both are declared rather than letting one be guessed and the other fought.
LANGUAGES = ("hi", "en")

# The most focused setting the API offers. One recording must not transcribe
# differently twice: the same audio was giving 18 deviation calls on one run and
# 22 on another, which reads as a pipeline fault rather than an ASR one.
TEMPERATURE = 0.0

# Boosted terms. `keywords` is the API's own mechanism for this and is stronger
# than naming them in the prompt. Deviation phrasings come first because they
# are what gets lost: two unstressed syllables after a long number.
KEYWORDS = (
    "okay", "minus", "plus",
    "minus one by eight", "minus one by four", "minus three by eight",
    "minus half", "minus quarter", "minus one by sixteen",
    "plus one by eight", "plus one by four", "plus three by eight",
    "plus half", "plus quarter", "plus one by sixteen",
    "one by eight", "three by eight", "five by eight", "seven by eight",
    "one by four", "three by four", "one by sixteen", "quarter", "half",
    "सवा", "पौने", "साढ़े", "डेढ़", "ढाई",
    "HPS", "POM", "BOM", "placket", "seersucker", "shirring", "neckband",
    "armhole", "bodice", "hem", "side seam", "grading", "nested nest",
    "shrinkage", "mini marker", "waistband", "inseam", "outseam",
    "saddle width", "J-stitch", "low hip", "bottom sweep", "yoke", "cuff",
    "gusset", "fly front", "size set",
)  # fmt: skip

# Steers the model on style and framing. The vocabulary itself now travels in
# KEYWORDS, which the API boosts properly.
DOMAIN_PROMPT = (
    "Garment size-set inspection at a factory, mixed Hindi and English. "
    "The recording opens by announcing the style number being inspected, as digits. "
    "An inspector reads each point of measure aloud, then its measured value, then "
    "either a deviation ('minus one by eight') or 'okay'. Every point of measure "
    "ends with one or the other; transcribe that verdict even when it is said "
    "quickly. Measurements are fractions of an inch spoken as 'one by eight', "
    "'three by four', 'quarter', 'सवा', 'पौने', 'साढ़े'. "
    "Transcribe numbers verbatim; do not translate."
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

        done = ""
        deltas: list[str] = []
        with upload.open("rb") as handle:
            stream = client.audio.transcriptions.create(
                model=settings.transcribe_model,
                file=handle,
                prompt=DOMAIN_PROMPT,
                keywords=list(KEYWORDS),
                languages=list(LANGUAGES),
                chunking_strategy=CHUNKING_STRATEGY,
                temperature=TEMPERATURE,
                stream=True,
            )
            for event in stream:
                if event.type == "transcript.text.delta":
                    deltas.append(event.delta)
                    if on_delta:
                        on_delta(event.delta)
                elif event.type == "transcript.text.done":
                    done = event.text

    # Chunked audio can deliver one "done" per chunk rather than one for the
    # whole file, in which case `done` holds only the last chunk. The deltas
    # carry every word either way, so keep whichever is longer instead of
    # throwing away a transcript we already have in hand.
    streamed = "".join(deltas)
    text = streamed if len(streamed) > len(done) else done

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
