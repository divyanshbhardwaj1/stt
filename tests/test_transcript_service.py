"""Transcription service, exercised against a fake OpenAI client."""

import types

import pytest

from services.transcript import (
    TranscriptionError,
    find_recordings,
    resolve_transcript,
    save_transcript,
    transcript_path_for,
)
from services.transcript import transcription_service as service


class FakeTranscriptionClient:
    """Replays the event stream the transcription API emits."""

    def __init__(self, final="hello world", deltas=("hello ", "world")):
        self.final = final
        self.deltas = deltas
        self.calls = []
        self.audio = types.SimpleNamespace(transcriptions=self)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        for delta in self.deltas:
            yield types.SimpleNamespace(type="transcript.text.delta", delta=delta)
        yield types.SimpleNamespace(type="transcript.text.other", delta="ignored")
        if self.final is not None:
            yield types.SimpleNamespace(type="transcript.text.done", text=self.final)


def test_streams_and_returns_final_text(settings, recording):
    seen = []

    text = service.transcribe_recording(
        recording, settings, client=FakeTranscriptionClient(), on_delta=seen.append
    )

    assert text == "hello world"
    assert seen == ["hello ", "world"]  # the ignored event type never reaches the caller


def test_sends_model_and_domain_prompt(settings, recording):
    client = FakeTranscriptionClient()

    service.transcribe_recording(recording, settings, client=client)

    sent = client.calls[0]
    assert sent["model"] == "gpt-transcribe"
    assert sent["stream"] is True
    assert "सवा" in sent["prompt"]  # Hindi fraction words steer the model
    assert "style number" in sent["prompt"]  # the opening announcement, as digits


def test_long_audio_is_chunked(settings, recording):
    """Unset, the API transcribes the whole upload as one block.

    A size-set inspection runs 30 to 60 minutes, and over that length the short
    verdict after each measurement goes missing. Chunking recovered most of
    them, so the parameter is pinned rather than left to a default.
    """
    client = FakeTranscriptionClient()

    service.transcribe_recording(recording, settings, client=client)

    assert client.calls[0]["chunking_strategy"] == "auto"


def test_deviation_vocabulary_is_boosted_and_both_languages_declared(settings, recording):
    client = FakeTranscriptionClient()

    service.transcribe_recording(recording, settings, client=client)

    sent = client.calls[0]
    assert "minus one by eight" in sent["keywords"]
    assert "okay" in sent["keywords"]
    assert sorted(sent["languages"]) == ["en", "hi"]
    assert sent["temperature"] == 0


def test_the_same_recording_transcribes_the_same_way(settings, recording):
    """Runs were differing by four deviation calls on identical audio."""
    client = FakeTranscriptionClient()

    service.transcribe_recording(recording, settings, client=client)

    assert client.calls[0]["temperature"] == 0


def test_rejects_oversized_recordings(settings, recording, monkeypatch):
    monkeypatch.setattr(service, "MAX_UPLOAD_BYTES", 1)

    with pytest.raises(TranscriptionError, match="over the"):
        service.transcribe_recording(recording, settings, client=FakeTranscriptionClient())


def test_the_streamed_deltas_survive_a_missing_done_event(settings, recording):
    """Chunked audio can deliver a "done" per chunk, or none at all.

    The deltas carry every word regardless, so a transcript already in hand is
    never thrown away for want of the closing event.
    """
    text = service.transcribe_recording(
        recording, settings, client=FakeTranscriptionClient(final=None)
    )

    assert text == "hello world"


def test_a_done_event_holding_only_the_last_chunk_does_not_win(settings, recording):
    """One "done" per chunk would otherwise truncate the whole transcript to it."""
    client = FakeTranscriptionClient(final="world", deltas=("hello ", "world"))

    assert service.transcribe_recording(recording, settings, client=client) == "hello world"


def test_raises_when_the_stream_is_empty(settings, recording):
    with pytest.raises(TranscriptionError, match="without a final transcript"):
        service.transcribe_recording(
            recording, settings, client=FakeTranscriptionClient(final=None, deltas=())
        )


def test_find_recordings_filters_by_suffix_and_sorts(settings):
    settings.recordings_dir.mkdir(parents=True)
    for name in ("b.wav", "a.m4a", "notes.pdf"):
        (settings.recordings_dir / name).touch()

    assert [p.name for p in find_recordings(settings.recordings_dir)] == ["a.m4a", "b.wav"]


def test_find_recordings_tolerates_a_missing_directory(settings):
    assert find_recordings(settings.recordings_dir) == []


def test_save_transcript_creates_the_directory(settings, recording):
    saved = save_transcript(recording, "text", settings)

    assert saved == transcript_path_for(recording, settings)
    assert saved.read_text(encoding="utf-8") == "text"


def test_resolve_transcript_accepts_a_bare_name(settings, recording):
    save_transcript(recording, "text", settings)

    assert resolve_transcript("Recording_20", settings).name == "Recording_20.txt"


def test_resolve_transcript_accepts_a_direct_path(settings, recording, tmp_path):
    elsewhere = tmp_path / "loose.txt"
    elsewhere.write_text("text")

    assert resolve_transcript(str(elsewhere), settings) == elsewhere


def test_resolve_transcript_keeps_dots_in_the_name(settings):
    """Recordings arrive as 'WhatsApp Audio 2026-08-18 at 16.05.21'; '.21' is not a suffix."""
    settings.transcripts_dir.mkdir(parents=True, exist_ok=True)
    awkward = "WhatsApp Audio 2026-08-18 at 16.05.21"
    (settings.transcripts_dir / f"{awkward}.txt").write_text("text")

    assert resolve_transcript(awkward, settings).stem == awkward


def test_resolve_transcript_still_accepts_a_recording_name(settings, recording):
    """Passing the audio file's name should find its transcript."""
    save_transcript(recording, "text", settings)

    assert resolve_transcript("Recording_20.m4a", settings).name == "Recording_20.txt"


def test_resolve_transcript_raises_when_absent(settings):
    with pytest.raises(FileNotFoundError, match="missing"):
        resolve_transcript("missing", settings)
