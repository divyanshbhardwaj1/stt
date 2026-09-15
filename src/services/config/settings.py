"""Environment and configuration for the whole application.

Everything the pipeline needs from the outside world is resolved here, once, and
passed down. No other module reads os.environ.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_TRANSCRIBE_MODEL = "gpt-transcribe"
DEFAULT_EXTRACT_MODEL = "gpt-5.6-sol"
# Live monitoring while the inspector is still in the room. Distinct from
# DEFAULT_TRANSCRIBE_MODEL: this one is tuned for latency, which is exactly the
# trade that loses short unstressed words, so it never feeds the report.
# Set SIZESET_REALTIME_MODEL="" to turn live transcription off entirely.
DEFAULT_REALTIME_MODEL = "gpt-live-transcribe"
DEFAULT_FORM_TEMPLATE = "size-set.xls"

# How many independent transcriptions of each recording to take. Two, because a
# single pass silently drops short verdicts and there is no way to tell from the
# result that it did. Set SIZESET_TRANSCRIBE_PASSES=1 to halve the transcription
# cost, accepting that more points of measure will come back unconfirmed.
DEFAULT_TRANSCRIBE_PASSES = 2


class ConfigError(RuntimeError):
    """Required configuration is missing or invalid."""


def load_env_file(path: Path | None = None) -> None:
    """Populate os.environ from a KEY=value file. Real environment variables win."""
    # ponytail: KEY=value lines only. Swap in python-dotenv if `export` prefixes
    # or multiline values ever turn up.
    path = path or PROJECT_ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if separator and not key.lstrip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def _whole(text: str | None, fallback: int) -> int:
    """A positive integer from the environment, or the fallback if it is not one."""
    try:
        return int(str(text).strip())
    except (TypeError, ValueError):
        return fallback


@dataclass(frozen=True)
class Settings:
    """Resolved configuration, passed to every service."""

    openai_api_key: str
    transcribe_model: str
    extract_model: str
    data_dir: Path
    realtime_model: str = DEFAULT_REALTIME_MODEL
    # Deepgram is used for ONE thing: a word-level time index so a reading can be
    # played back. It never transcribes for the report. Absent key means playback
    # is not offered, which is the whole of its failure mode.
    deepgram_api_key: str = ""
    form_template_name: str = DEFAULT_FORM_TEMPLATE
    transcribe_passes: int = DEFAULT_TRANSCRIBE_PASSES

    @property
    def recordings_dir(self) -> Path:
        """Inspection audio, as recorded on the factory floor."""
        return self.data_dir / "recordings"

    @property
    def transcripts_dir(self) -> Path:
        """Saved transcripts, one text file per recording."""
        return self.data_dir / "transcripts"

    @property
    def references_dir(self) -> Path:
        """Client reference documents: blank forms and filled examples."""
        return self.data_dir / "references"

    @property
    def style_sets_dir(self) -> Path:
        """Graded spec sheets, one PDF per style, named for its style number."""
        return self.data_dir / "StyleSets"

    @property
    def output_dir(self) -> Path:
        """Generated reports."""
        return self.data_dir / "output"

    @property
    def form_template_path(self) -> Path:
        """The client's blank Size Set Inspection Report workbook.

        This file defines the strict output layout for both the CSV and the PDF.
        """
        return self.references_dir / self.form_template_name

    @classmethod
    def load(cls, env: dict[str, str] | None = None) -> Settings:
        """Read settings, failing fast with an actionable message if the key is absent."""
        if env is None:
            load_env_file()
            env = dict(os.environ)
        api_key = env.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise ConfigError(
                "OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in."
            )
        return cls(
            openai_api_key=api_key,
            transcribe_model=env.get("SIZESET_TRANSCRIBE_MODEL", DEFAULT_TRANSCRIBE_MODEL),
            extract_model=env.get("SIZESET_EXTRACT_MODEL", DEFAULT_EXTRACT_MODEL),
            realtime_model=env.get("SIZESET_REALTIME_MODEL", DEFAULT_REALTIME_MODEL),
            deepgram_api_key=env.get("DEEPGRAM_API_KEY", "").strip(),
            data_dir=Path(env.get("SIZESET_DATA_DIR") or PROJECT_ROOT / "data"),
            form_template_name=env.get("SIZESET_FORM_TEMPLATE", DEFAULT_FORM_TEMPLATE),
            transcribe_passes=max(
                1,
                _whole(env.get("SIZESET_TRANSCRIBE_PASSES"), DEFAULT_TRANSCRIBE_PASSES),
            ),
        )
