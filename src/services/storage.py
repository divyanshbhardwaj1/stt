"""Object storage: where recordings and finished reports actually live.

The pipeline works on local paths and will go on working on local paths. ffmpeg
wants a file, pypdf wants a file, and rewriting eight stages to stream from a
bucket would buy nothing but a longer diff. So local disk stays the *working*
copy and the bucket is the *durable* one: everything is written to disk first,
mirrored up after, and fetched back down on a machine that does not have it.

That asymmetry is the whole feature. Today a report only exists on the one
filesystem that produced it, which means one server, no redeploys that replace
a container, and a disk failure that loses the client's documents. With a
bucket behind it any machine can answer for any inspection — it pulls what it
is missing on first ask and caches it.

Three decisions worth keeping:

  * **Optional, like the database.** No bucket configured means the app behaves
    exactly as it did before: disk only. Same scaffolding argument as
    `services/db/session.py`, and the same ending — once uploads land here by
    default there is nothing useful to do without it.
  * **Presigned GETs, not proxied bytes.** A half-hour recording is tens of
    megabytes and the browser seeks around it. Handing out a signed URL lets S3
    answer the `Range` requests directly; proxying them through FastAPI spends
    an app worker per listening operator to move bytes it already has a CDN
    for.
  * **A mirror failure is not a run failure.** The pipeline's output is on disk
    the moment it is written. Losing the copy costs durability, not work, and a
    transcription that took eight minutes must not be thrown away because a
    bucket blipped. Fetching is the other way round: if a file is not local and
    cannot be pulled, that is a real error and the caller hears about it.

Configuration is read from the environment rather than `Settings` for the same
reason `DATABASE_URL` is: a worker or a migration needs somewhere to put a file
without constructing the whole application config, OpenAI key and all. Railway,
MinIO, R2 and AWS all spell the same five values differently, so each is looked
up under the names each provider hands out.
"""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import os
import threading
from pathlib import Path

log = logging.getLogger(__name__)

# Key prefixes. Flat and boring on purpose: the bucket is not a filesystem and
# nothing lists it by directory.
RECORDINGS = "recordings"
PLAYBACK = "playback"
OUTPUTS = "outputs"
STYLE_SETS = "style-sets"

# How long a signed link stays good. It is handed to a browser, so it lands in
# history, in any proxy log on the way, and in whatever mirrors those. Long
# enough to start a download and seek around a half-hour recording; short
# enough that a URL copied out of a log is useless by the time anyone tries it.
LINK_SECONDS = 15 * 60

# Where each setting might be spelled, in order of preference. The generic
# S3_* names win so that a deployment can override whatever the platform
# injected without unsetting the platform's own variables.
_NAMES = {
    "bucket": ("S3_BUCKET", "BUCKET_NAME", "AWS_S3_BUCKET"),
    "endpoint": ("S3_ENDPOINT_URL", "BUCKET_ENDPOINT_URL", "AWS_ENDPOINT_URL_S3"),
    "key": ("S3_ACCESS_KEY_ID", "BUCKET_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"),
    "secret": ("S3_SECRET_ACCESS_KEY", "BUCKET_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"),
    "region": ("S3_REGION", "BUCKET_REGION", "AWS_REGION"),
}

_client = None
_lock = threading.Lock()


class StorageError(RuntimeError):
    """A bucket is configured but did not answer."""


def _setting(field: str) -> str:
    for name in _NAMES[field]:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return ""


def bucket() -> str:
    """The bucket to use, or "" when object storage is not configured."""
    return _setting("bucket")


def enabled() -> bool:
    return bool(bucket())


def reset() -> None:
    """Forget the cached client, so a changed environment is picked up.

    Only tests need this. The process reads its configuration once otherwise.
    """
    global _client
    with _lock:
        _client = None


def client():
    """The S3 client, built on first use.

    boto3 is imported here rather than at module scope so that a checkout
    without it — or a run with no bucket configured — never pays for the import
    or fails on it. It pulls in botocore, which is not small.
    """
    global _client
    if _client is not None:
        return _client
    with _lock:
        if _client is None:
            import boto3
            from botocore.config import Config

            endpoint = _setting("endpoint")
            _client = boto3.client(
                "s3",
                endpoint_url=endpoint or None,
                region_name=_setting("region") or "us-east-1",
                aws_access_key_id=_setting("key") or None,
                aws_secret_access_key=_setting("secret") or None,
                config=Config(
                    signature_version="s3v4",
                    # Virtual-host addressing (bucket.host) needs a DNS record
                    # per bucket, which only AWS has. Every S3-compatible
                    # provider — Railway, MinIO, R2 — serves the bucket as the
                    # first path segment, and asking for the other style gets a
                    # name resolution error rather than an HTTP one.
                    s3={"addressing_style": "path" if endpoint else "auto"},
                    retries={"max_attempts": 3, "mode": "standard"},
                ),
            )
    return _client


# ---------------------------------------------------------------------- keys
def recording_key(filename: str) -> str:
    """Where an inspection recording lives. The upload name is already unique:
    `_free_path` never hands out a name a recording already has."""
    return f"{RECORDINGS}/{Path(filename).name}"


def playback_key(filename: str) -> str:
    """The seekable re-encode of that recording — a second object, not a
    replacement. The original is what was captured on the floor and what the
    word index was built from; this one exists only so a browser can seek."""
    return f"{PLAYBACK}/{Path(filename).stem}.mp3"


def style_set_key(filename: str) -> str:
    """A buyer's graded spec sheet. Named for the style, so re-uploading the
    same style replaces the object rather than accumulating copies."""
    return f"{STYLE_SETS}/{Path(filename).name}"


def output_key(name: str, filename: str) -> str:
    """One finished output. Grouped by inspection so that everything belonging
    to a report can be listed, or expired, as a unit."""
    return f"{OUTPUTS}/{name}/{Path(filename).name}"


# What this application actually stores, stated rather than guessed.
#
# `mimetypes` consults the Windows registry, where `.csv` is whatever Excel
# claimed it — `application/vnd.ms-excel` on the machine this was written on.
# An object is stamped once, at upload, and served with that type forever, so
# guessing would mean the same report arriving as a spreadsheet or as text
# depending on which machine happened to process it. `.webm` is the other one:
# the registry calls it video, and MediaRecorder here only ever records audio.
_TYPES = {
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".json": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".webm": "audio/webm",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/ogg",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".amr": "audio/amr",
}


def content_type(path: Path) -> str:
    """How the bucket should serve this file, for the life of the object."""
    known = _TYPES.get(path.suffix.lower())
    if known:
        return known
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def sha256_of(path: Path) -> str:
    """The content hash, read in chunks — recordings run to hundreds of
    megabytes and there is no reason to hold one in memory to hash it."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


# --------------------------------------------------------------------- moving
def put(key: str, path: Path) -> None:
    """Upload a file. Raises if the bucket refuses it."""
    client().upload_file(
        str(path), bucket(), key, ExtraArgs={"ContentType": content_type(path)}
    )
    log.info("stored %s (%.1f MB)", key, path.stat().st_size / 1e6)


def mirror(key: str, path: Path) -> bool:
    """Upload a file, swallowing failure.

    For the copies that are a durability measure rather than the work itself.
    See the module docstring: the report is on disk by the time this runs.
    """
    if not enabled() or not path.is_file():
        return False
    try:
        put(key, path)
        return True
    except Exception:  # noqa: BLE001 - a bookkeeping copy must not kill a run
        log.exception("could not store %s", key)
        return False


def exists(key: str) -> bool:
    if not enabled():
        return False
    try:
        client().head_object(Bucket=bucket(), Key=key)
        return True
    except Exception:  # noqa: BLE001 - absent, or unreachable; same answer here
        return False


def mirror_once(key: str, path: Path) -> bool:
    """Upload only if the object is not already there.

    One HEAD to save re-uploading a file on every request. It also self-heals:
    an object deleted out from under us is simply put back.
    """
    if not enabled() or not path.is_file():
        return False
    return True if exists(key) else mirror(key, path)


def fetch(key: str, destination: Path) -> bool:
    """Download an object to a local path. False when it is not there.

    Written to a neighbouring temporary file and moved into place, so a
    half-finished download can never be mistaken for the real file by the very
    next request — which, with two workers, is a live possibility.
    """
    if not enabled():
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(f".{destination.name}.part")
    try:
        client().download_file(bucket(), key, str(partial))
        partial.replace(destination)
        log.info("fetched %s", key)
        return True
    except Exception:  # noqa: BLE001 - absent, or unreachable; the caller decides
        partial.unlink(missing_ok=True)
        log.warning("could not fetch %s", key)
        return False


def pull_all(prefix: str, directory: Path) -> int:
    """Fill `directory` with everything under `prefix` that is not there yet.

    The style set library is the one thing a container must have before it can
    grade anything, and on a platform with an ephemeral disk an uploaded sheet
    would otherwise last until the next deploy. Existing files are left alone:
    the bucket is the durable copy, not the authority.
    """
    if not enabled():
        return 0
    directory.mkdir(parents=True, exist_ok=True)
    pulled = 0
    try:
        pages = client().get_paginator("list_objects_v2")
        for page in pages.paginate(Bucket=bucket(), Prefix=f"{prefix}/"):
            for item in page.get("Contents", ()):
                name = Path(item["Key"]).name
                if name and not (directory / name).is_file():
                    pulled += fetch(item["Key"], directory / name)
    except Exception:  # noqa: BLE001 - unreachable bucket; disk is still served
        log.warning("could not list %s", prefix)
    return pulled


def ensure_local(key: str, path: Path) -> bool:
    """`path`, present. Already there, or pulled from the bucket.

    The cache-fill that makes a second server work: a container that has never
    seen this inspection answers for it anyway.
    """
    return path.is_file() or fetch(key, path)


def presign(key: str, *, filename: str = "", download: bool = False) -> str:
    """A signed URL the browser can fetch directly.

    `Range` comes free — which is the point for audio, where the player asks
    for a few seconds out of the middle of a large file.
    """
    params: dict[str, str] = {"Bucket": bucket(), "Key": key}
    if filename:
        disposition = "attachment" if download else "inline"
        params["ResponseContentDisposition"] = f'{disposition}; filename="{filename}"'
    return client().generate_presigned_url(
        "get_object", Params=params, ExpiresIn=LINK_SECONDS
    )


def delete(key: str) -> None:
    client().delete_object(Bucket=bucket(), Key=key)


def forget(key: str) -> bool:
    '''Delete an object, swallowing failure - the counterpart to `mirror`.

    The local file is already gone by the time this runs. An unreachable bucket
    must not turn a completed removal into a 500 the operator retries.
    '''
    if not enabled():
        return False
    try:
        delete(key)
        return True
    except Exception:  # noqa: BLE001 - the disk copy is already gone
        log.warning('could not delete %s from the bucket', key)
        return False


# ---------------------------------------------------------------------- check
def check() -> str:
    """Round-trip a small object: put, head, fetch, presign, delete.

    ponytail: this is the one runnable check. It proves the five settings
    actually agree with the bucket, which is not something a unit test against
    a stub can tell you — wrong region, path-style addressing, and a key with
    read-only permission all pass every mock and fail here.
    """
    import tempfile

    if not enabled():
        raise StorageError(
            "no bucket configured. Set S3_BUCKET, S3_ENDPOINT_URL, "
            "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in .env"
        )
    key = f"{OUTPUTS}/.check/{os.getpid()}.txt"
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / "check.txt"
        source.write_text("size-set storage check", encoding="utf-8")
        back = Path(directory) / "back.txt"
        try:
            put(key, source)
            if not exists(key):
                raise StorageError(f"wrote {key} and it is not there")
            if not fetch(key, back):
                raise StorageError(f"wrote {key} and could not read it back")
            if back.read_text(encoding="utf-8") != "size-set storage check":
                raise StorageError(f"{key} came back with different contents")
            url = presign(key, filename="check.txt")
        finally:
            try:
                delete(key)
            except Exception:  # noqa: BLE001 - the check itself already reported
                log.warning("left %s behind in the bucket", key)
    host = url.split("?", 1)[0]
    return f"bucket {bucket()} is writable, readable and signs URLs ({host})"


if __name__ == "__main__":  # pragma: no cover - operator convenience
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from services.config.settings import load_env_file

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    load_env_file()
    try:
        print(check())
    except Exception as exc:  # noqa: BLE001 - an operator wants the reason, not a traceback
        sys.exit(f"storage check failed: {exc}")
