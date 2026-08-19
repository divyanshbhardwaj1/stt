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

    def __init__(self, final="hello world"):
        self.final = final
        self.calls = []
        self.audio = types.SimpleNamespace(transcriptions=self)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        for delta in ("hello ", "world"):
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


def test_rejects_oversized_recordings(settings, recording, monkeypatch):
    monkeypatch.setattr(service, "MAX_UPLOAD_BYTES", 1)

    with pytest.raises(TranscriptionError, match="over the"):
        service.transcribe_recording(recording, settings, client=FakeTranscriptionClient())


def test_raises_when_the_stream_has_no_final_event(settings, recording):
    with pytest.raises(TranscriptionError, match="without a final transcript"):
        service.transcribe_recording(
            recording, settings, client=FakeTranscriptionClient(final=None)
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


def test_resolve_transcript_raises_when_absent(settings):
    with pytest.raises(FileNotFoundError, match="missing"):
        resolve_transcript("missing", settings)
