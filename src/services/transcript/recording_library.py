"""Finding recordings on disk and knowing where their transcripts belong."""

from __future__ import annotations

import logging
from pathlib import Path

from services.config import Settings

log = logging.getLogger(__name__)

AUDIO_SUFFIXES = frozenset({".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm"})


def find_recordings(directory: Path) -> list[Path]:
    """Every supported recording in `directory`, sorted by name."""
    if not directory.is_dir():
        return []
    return sorted(path for path in directory.iterdir() if path.suffix.lower() in AUDIO_SUFFIXES)


def transcript_path_for(recording: Path, settings: Settings) -> Path:
    """Where the transcript for `recording` lives."""
    return settings.transcripts_dir / f"{recording.stem}.txt"


def live_transcript_path_for(recording: Path, settings: Settings) -> Path:
    """Where the live monitoring transcript for `recording` is kept.

    Beside the batch transcript and its second pass, following the same
    convention, so all three readings of one recording sit together for a
    reviewer to compare. It is saved for audit only: nothing downstream reads
    it, because a latency-tuned model is the wrong source for a verdict.
    """
    return settings.transcripts_dir / f"{recording.stem}.live.txt"


def save_transcript(recording: Path, text: str, settings: Settings) -> Path:
    """Write `text` alongside the other transcripts and return the path."""
    destination = transcript_path_for(recording, settings)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(text, encoding="utf-8")
    log.info("wrote %s (%d chars)", destination, len(text))
    return destination


def resolve_transcript(name_or_path: str, settings: Settings) -> Path:
    """Accept a path to a transcript, or the bare name of one.

    The full name is tried before the stem, because recordings arrive named
    "WhatsApp Audio 2026-08-18 at 16.05.21" and treating ".21" as a file
    extension would look for the wrong transcript.

    Raises FileNotFoundError if nothing resolves.
    """
    given = Path(name_or_path)
    candidates = (
        given,
        settings.transcripts_dir / f"{name_or_path}.txt",
        settings.transcripts_dir / name_or_path,
        settings.transcripts_dir / f"{given.stem}.txt",
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"no transcript named {name_or_path!r} in {settings.transcripts_dir}")
