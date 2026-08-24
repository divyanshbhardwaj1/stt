"""Transcription service: recordings in, text out."""

from .audio_prep import AudioPrepError, compress_for_upload, ffmpeg_executable
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
    "AudioPrepError",
    "TranscriptionError",
    "compress_for_upload",
    "ffmpeg_executable",
    "find_recordings",
    "resolve_transcript",
    "save_transcript",
    "transcribe_recording",
    "transcript_path_for",
]
