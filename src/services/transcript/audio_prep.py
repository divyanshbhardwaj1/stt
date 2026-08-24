"""Shrinking oversized recordings so they fit the transcription API's limit.

Inspections are recorded on phones at whatever quality the handset defaults to —
the reference recording for style 9662 is half an hour of 48 kHz stereo at
192 kb/s, which is 46 MB and nearly twice the API's cap.

Speech recognition resamples to 16 kHz mono internally, so re-encoding to that
loses nothing that matters and shrinks the file by roughly 20x. ffmpeg ships as
a pip wheel, so this needs no system install.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

import imageio_ffmpeg

log = logging.getLogger(__name__)

# Mono, 16 kHz, 48 kb/s: what speech recognition uses anyway. Half an hour comes
# out around 10 MB.
SPEECH_CODEC_ARGS = ("-ac", "1", "-ar", "16000", "-b:a", "48k")
COMPRESSED_SUFFIX = ".mp3"
FFMPEG_TIMEOUT_SECONDS = 900


class AudioPrepError(RuntimeError):
    """The recording could not be re-encoded."""


def ffmpeg_executable() -> str:
    """Path to the bundled ffmpeg binary."""
    try:
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # noqa: BLE001 - the helper raises several types
        raise AudioPrepError(f"no usable ffmpeg: {exc}") from exc


def compress_for_upload(source: Path, destination: Path) -> Path:
    """Re-encode `source` to a compact speech-quality copy at `destination`."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg_executable(),
        "-hide_banner",
        "-loglevel", "error",
        "-nostdin",
        "-y",
        "-i", str(source),
        "-vn",  # some recordings arrive as .mp4 with a cover image
        *SPEECH_CODEC_ARGS,
        str(destination),
    ]  # fmt: skip

    log.info("re-encoding %s for upload", source.name)
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT_SECONDS
        )
    except subprocess.TimeoutExpired as exc:
        raise AudioPrepError(f"re-encoding {source.name} timed out") from exc

    if result.returncode != 0 or not destination.is_file():
        detail = (result.stderr or "").strip().splitlines()
        raise AudioPrepError(
            f"could not re-encode {source.name}: {detail[-1] if detail else 'ffmpeg failed'}"
        )

    log.info(
        "re-encoded %s: %.1f MB -> %.1f MB",
        source.name,
        source.stat().st_size / 1e6,
        destination.stat().st_size / 1e6,
    )
    return destination


def compressed_name(source: Path) -> str:
    return f"{source.stem}{COMPRESSED_SUFFIX}"
