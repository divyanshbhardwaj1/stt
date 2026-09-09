"""Transcription service: recordings in, text out."""

from .audio_prep import (
    AudioPrepError,
    compress_for_upload,
    compressed_name,
    ffmpeg_executable,
)
from .recording_library import (
    AUDIO_SUFFIXES,
    find_recordings,
    live_transcript_path_for,
    resolve_transcript,
    save_transcript,
    transcript_path_for,
)
from .transcription_service import (
    DOMAIN_PROMPT,
    KEYWORDS,
    LANGUAGES,
    TranscriptionError,
    transcribe_recording,
)

__all__ = [
    "AUDIO_SUFFIXES",
    "DOMAIN_PROMPT",
    "KEYWORDS",
    "LANGUAGES",
    "AudioPrepError",
    "TranscriptionError",
    "compress_for_upload",
    "compressed_name",
    "ffmpeg_executable",
    "find_recordings",
    "live_transcript_path_for",
    "resolve_transcript",
    "save_transcript",
    "transcribe_recording",
    "transcript_path_for",
]
