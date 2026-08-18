"""Transcribe audio with OpenAI's best speech-to-text model.

Usage:  python stt.py          -> pick one file from audio/, transcribe it, exit
        python stt.py a.mp3   -> skip the menu, transcribe that file
Needs:  OPENAI_API_KEY in .env (or the environment).
"""

import os
import sys
from pathlib import Path

from openai import OpenAI

MODEL = "gpt-transcribe"  # OpenAI's recommended/highest-quality file-transcription model
EXTS = {".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm"}
HERE = Path(__file__).parent
AUDIO, OUT = HERE / "audio", HERE / "transcripts"


def load_env(path=HERE / ".env"):
    # ponytail: KEY=value lines only. Use python-dotenv if you ever need quotes spanning lines or `export`.
    for line in path.read_text().splitlines() if path.exists() else []:
        key, _, value = line.partition("=")
        if _ and not key.lstrip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def transcribe(path, client=None):
    """Stream the transcript to stdout as it arrives; return the final text."""
    client = client or OpenAI()
    text = ""
    # ponytail: 25 MB API cap. Split with pydub/ffmpeg if you need longer audio.
    with open(path, "rb") as f:
        for event in client.audio.transcriptions.create(model=MODEL, file=f, stream=True):
            if event.type == "transcript.text.delta":
                print(event.delta, end="", flush=True)
            elif event.type == "transcript.text.done":
                text = event.text
    print()
    return text


def pick(files):
    """Numbered menu. Returns the chosen file, or None to quit."""
    for i, f in enumerate(files, 1):
        done = "  (done)" if (OUT / f"{f.stem}.txt").exists() else ""
        print(f"{i:>3}. {f.name}{done}")
    while True:
        choice = input("\npick a number (blank to quit): ").strip()
        if not choice:
            return None
        if choice.isdigit() and 1 <= int(choice) <= len(files):
            return files[int(choice) - 1]
        print("no such number")


def main(args):
    load_env()
    AUDIO.mkdir(exist_ok=True)
    OUT.mkdir(exist_ok=True)
    files = sorted(f for f in AUDIO.iterdir() if f.suffix.lower() in EXTS)
    if not files:
        return print(f"no audio files in {AUDIO}")
    chosen = Path(args[0]) if args else pick(files)
    if not chosen:
        return
    out = OUT / f"{chosen.stem}.txt"
    print(f"\n--- {chosen.name}\n")
    out.write_text(transcribe(chosen), encoding="utf-8")
    print(f"-> {out}")


if __name__ == "__main__":
    main(sys.argv[1:])
