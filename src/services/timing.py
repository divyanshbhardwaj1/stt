"""Where in the recording each reading was said, so it can be played back.

The report's own transcription cannot answer this: `gpt-transcribe` rejects
`response_format=verbose_json` outright, so it emits no timings at all. A second
engine has to supply them, and it is used for nothing else - the report is still
built from the two gpt-transcribe passes, whose exact phrasing the extraction
prompt and the aligner's thresholds are tuned against.

Deepgram rather than whisper-1, measured rather than assumed. On a 13-minute
English-dominant inspection whisper-1 was excellent: 40 of 40 readings placed,
the spoken number a median 6.4s after the anchor. On a 30-minute Hindi-dominant
one it collapsed - 391 words against gpt-transcribe's 2236, all in Devanagari so
no point of measure could ever match, and degenerate loops once re-encoded. Half
this floor's speech is Hindi, so that engine cannot be the index.

The REST API directly, not the SDK: this is one POST and one JSON shape, and a
dependency that exists to save twenty lines is a dependency to keep current.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

import httpx

from services.config import Settings

log = logging.getLogger(__name__)

ENDPOINT = "https://api.deepgram.com/v1/listen"
# nova-3 with multi-language: the code-switching is the point. Punctuation off -
# nothing here reads the words, only their times.
PARAMS = {
    "model": "nova-3",
    "language": "multi",
    "smart_format": "false",
    "punctuate": "false",
}
UPLOAD_TIMEOUT_SECONDS = 600
# Deepgram accepts far larger files than the transcription API, so a recording
# that fits the report pipeline fits this untouched. Re-encoding is what turned
# whisper-1's output into a loop, and is not done here.
MAX_INDEX_BYTES = 2_000_000_000


class TimingError(RuntimeError):
    """A time index could not be built, said plainly enough to act on."""


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class WordIndex:
    """Every word in a recording with the second it was said."""

    duration: float
    words: tuple[Word, ...]

    def to_payload(self) -> dict:
        return {
            "duration": self.duration,
            "words": [{"w": w.text, "s": w.start, "e": w.end} for w in self.words],
        }

    @classmethod
    def from_payload(cls, payload: dict) -> WordIndex:
        return cls(
            duration=float(payload.get("duration") or 0.0),
            words=tuple(
                Word(text=w["w"], start=float(w["s"]), end=float(w["e"]))
                for w in payload.get("words", [])
            ),
        )


def index_path_for(recording: Path, settings: Settings) -> Path:
    """Where a recording's time index is cached, beside its transcripts."""
    return settings.transcripts_dir / f"{recording.stem}.words.json"


def word_index(
    recording: Path, settings: Settings, client: httpx.Client | None = None
) -> WordIndex:
    """The recording's words and their times, building and caching on first ask.

    Lazy on purpose. Most inspections are never listened back to, and paying to
    index every one of them would be paying for a feature nobody used.
    """
    cached = index_path_for(recording, settings)
    if cached.is_file():
        return WordIndex.from_payload(json.loads(cached.read_text(encoding="utf-8")))

    if not settings.deepgram_api_key:
        raise TimingError(
            "playback needs a word-level time index, and no DEEPGRAM_API_KEY is set. "
            "The report's own transcription cannot supply one: gpt-transcribe does "
            "not return timings."
        )
    if not recording.is_file():
        raise TimingError(f"{recording.name} is no longer in the recordings folder.")
    size = recording.stat().st_size
    if size > MAX_INDEX_BYTES:
        raise TimingError(f"{recording.name} is {size / 1e9:.1f} GB, too large to index.")

    log.info("building a time index for %s (%.1f MB)", recording.name, size / 1e6)
    owned = client is None
    client = client or httpx.Client(timeout=UPLOAD_TIMEOUT_SECONDS)
    try:
        with recording.open("rb") as handle:
            response = client.post(
                ENDPOINT,
                params=PARAMS,
                headers={"Authorization": f"Token {settings.deepgram_api_key}"},
                content=handle.read(),
            )
    except httpx.HTTPError as exc:
        raise TimingError(f"could not reach the timing service: {exc}") from exc
    finally:
        if owned:
            client.close()

    if response.status_code != 200:
        # The upstream reason verbatim: a rejected key and an unsupported format
        # need different things done about them.
        raise TimingError(
            f"timing service refused the recording ({response.status_code}): {_detail(response)}"
        )

    index = _read(response.json())
    if not index.words:
        raise TimingError(f"{recording.name} produced no words to index.")
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(index.to_payload()), encoding="utf-8")
    log.info("indexed %s: %d words over %.0fs", recording.name, len(index.words), index.duration)
    return index


def _detail(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return response.text[:200]
    return str(body.get("err_msg") or body.get("error") or body)[:200]


def _read(payload: dict) -> WordIndex:
    """Pull the flat word list out of Deepgram's nested response."""
    duration = float(payload.get("metadata", {}).get("duration") or 0.0)
    channels = payload.get("results", {}).get("channels") or []
    alternatives = channels[0].get("alternatives") if channels else None
    raw = (alternatives[0].get("words") if alternatives else None) or []
    words = tuple(
        Word(text=str(w.get("word", "")), start=float(w["start"]), end=float(w["end"]))
        for w in raw
        if "start" in w and "end" in w
    )
    return WordIndex(duration=duration, words=words)
