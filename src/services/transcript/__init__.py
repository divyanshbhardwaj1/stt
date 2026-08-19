"""Transcription service: recordings in, text out."""

from .recording_library import (
    AUDIO_SUFFIXES,
    find_recordings,
    resolve_transcript,
    save_transcript,
    transcript_path_for,
)
from .transcription_service import DOMAIN_PROMPT, TranscriptionError, transcribe_recording

__all__ = [
    "AUDIO_SUFFIXES",
    "DOMAIN_PROMPT",
    "TranscriptionError",
    "find_recordings",
    "resolve_transcript",
    "save_transcript",
    "transcribe_recording",
    "transcript_path_for",
]
