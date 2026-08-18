"""Self-check: run `python test_stt.py`. No API key or network needed."""

import builtins
import os
import tempfile
import types
from pathlib import Path

import stt


class FakeClient:
    """Replays the event stream the real API emits."""

    def __init__(self):
        self.audio = types.SimpleNamespace(transcriptions=self)

    def create(self, **kwargs):
        assert kwargs["model"] == stt.MODEL and kwargs["stream"] is True
        for t, d in [("delta", "hello "), ("delta", "world"), ("other", "ignore me")]:
            yield types.SimpleNamespace(type=f"transcript.text.{t}", delta=d)
        yield types.SimpleNamespace(type="transcript.text.done", text="hello world")


if __name__ == "__main__":
    assert stt.transcribe(__file__, FakeClient()) == "hello world"

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        (tmp / ".env").write_text('# OPENAI_API_KEY=commented\nSTT_TEST_KEY="sk-test"\n')
        stt.load_env(tmp / ".env")
        assert os.environ["STT_TEST_KEY"] == "sk-test"
        assert "commented" not in os.environ.get("# OPENAI_API_KEY", "")

        stt.AUDIO, stt.OUT = tmp / "audio", tmp / "transcripts"
        stt.AUDIO.mkdir()
        for name in ("one.wav", "two.wav", "notes.pdf"):
            (stt.AUDIO / name).touch()
        stt.transcribe = lambda f, client=None: f"text of {f.name}"

        answers = iter(["9", "x", "2"])  # bad number, junk, then a real pick
        builtins.input = lambda _: next(answers)
        stt.main([])
        assert (stt.OUT / "two.txt").read_text() == "text of two.wav"  # menu skips notes.pdf
        assert not (stt.OUT / "one.txt").exists()  # only the picked file ran

        builtins.input = lambda _: ""  # blank quits without transcribing
        stt.main([])
        assert not (stt.OUT / "one.txt").exists()

    print("ok")
