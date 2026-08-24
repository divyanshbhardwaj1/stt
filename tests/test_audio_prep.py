"""Re-encoding oversized recordings, and the transcription path that uses it."""

import subprocess

import pytest

from services.transcript import AudioPrepError, compress_for_upload, ffmpeg_executable
from services.transcript import transcription_service as service

from .test_transcript_service import FakeTranscriptionClient


@pytest.fixture
def loud_recording(tmp_path):
    """A real audio file, synthesised at a deliberately wasteful bitrate."""
    path = tmp_path / "loud.m4a"
    subprocess.run(
        [
            ffmpeg_executable(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=20",
            "-ac",
            "2",
            "-ar",
            "48000",
            "-b:a",
            "256k",
            str(path),
        ],  # fmt: skip
        check=True,
        capture_output=True,
    )
    return path


def test_ffmpeg_is_available_without_a_system_install():
    """It ships as a pip wheel, so nothing has to be installed on the machine."""
    assert ffmpeg_executable()


def test_compression_shrinks_the_file(tmp_path, loud_recording):
    compressed = compress_for_upload(loud_recording, tmp_path / "small.mp3")

    assert compressed.is_file()
    assert compressed.stat().st_size < loud_recording.stat().st_size


def test_compression_leaves_the_original_alone(tmp_path, loud_recording):
    before = loud_recording.read_bytes()

    compress_for_upload(loud_recording, tmp_path / "small.mp3")

    assert loud_recording.read_bytes() == before


def test_compressing_something_that_is_not_audio_fails_clearly(tmp_path):
    junk = tmp_path / "junk.m4a"
    junk.write_bytes(b"not audio at all")

    with pytest.raises(AudioPrepError, match="could not re-encode"):
        compress_for_upload(junk, tmp_path / "out.mp3")


def test_a_small_recording_is_uploaded_untouched(settings, recording, monkeypatch):
    """Compression is for oversized files only; nothing else pays for it."""
    calls = []
    monkeypatch.setattr(service, "compress_for_upload", lambda *a, **k: calls.append(a))

    service.transcribe_recording(recording, settings, client=FakeTranscriptionClient())

    assert calls == []


# Between the 20-second clip's original size and its re-encoded size, so the
# oversized path runs and then succeeds.
BETWEEN_SIZES = 300_000


def test_an_oversized_recording_is_re_encoded_then_transcribed(
    settings, loud_recording, monkeypatch
):
    monkeypatch.setattr(service, "MAX_UPLOAD_BYTES", BETWEEN_SIZES)
    said = []

    text = service.transcribe_recording(
        loud_recording, settings, client=FakeTranscriptionClient(), announce=said.append
    )

    assert text == "hello world"
    assert any("re-encoding" in message for message in said)


def test_the_re_encoded_copy_is_cleaned_up(settings, loud_recording, monkeypatch):
    """The scratch copy lives in a temp dir; check that exact path is gone after."""
    monkeypatch.setattr(service, "MAX_UPLOAD_BYTES", BETWEEN_SIZES)
    written = []
    real = service.compress_for_upload

    def spy(source, destination):
        written.append(destination)
        return real(source, destination)

    monkeypatch.setattr(service, "compress_for_upload", spy)

    service.transcribe_recording(loud_recording, settings, client=FakeTranscriptionClient())

    assert written, "expected the recording to be re-encoded"
    assert not written[0].exists()


def test_a_recording_that_will_not_shrink_enough_is_reported(settings, loud_recording, monkeypatch):
    """One re-encode, no chunking; say so rather than uploading and failing."""
    monkeypatch.setattr(service, "MAX_UPLOAD_BYTES", 1)

    with pytest.raises(service.TranscriptionError, match="still .* MB after re-encoding"):
        service.transcribe_recording(loud_recording, settings, client=FakeTranscriptionClient())


def test_a_failed_re_encode_is_reported_with_the_size(settings, tmp_path, monkeypatch):
    monkeypatch.setattr(service, "MAX_UPLOAD_BYTES", 4)
    junk = tmp_path / "junk.m4a"
    junk.write_bytes(b"not audio at all")

    with pytest.raises(service.TranscriptionError, match="could not be re-encoded"):
        service.transcribe_recording(junk, settings, client=FakeTranscriptionClient())
