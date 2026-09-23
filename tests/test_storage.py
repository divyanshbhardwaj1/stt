"""Object storage, against a stub bucket.

A stub rather than a real one on purpose: what these tests are for is the
behaviour around the bucket — what happens when it is absent, when it fails,
when the file is here already, when it is only there. Whether the five settings
actually agree with a live endpoint is a different question and no mock can
answer it; `python src/services/storage.py` does, against the real
thing.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.parse import unquote

import pytest

from api import jobs
from services import storage

from .test_api import _finish


class Missing(Exception):
    """What a stub bucket raises for an object it does not have."""


class FakeS3:
    """Enough of an S3 client for the five calls storage.py makes."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.types: dict[str, str] = {}
        self.uploads = 0
        self.fail = False

    def upload_file(self, Filename, Bucket, Key, ExtraArgs=None):  # noqa: N803
        if self.fail:
            raise Missing("bucket is down")
        self.uploads += 1
        self.objects[Key] = Path(Filename).read_bytes()
        self.types[Key] = (ExtraArgs or {}).get("ContentType", "")

    def download_file(self, Bucket, Key, Filename):  # noqa: N803
        if Key not in self.objects:
            raise Missing(Key)
        Path(Filename).write_bytes(self.objects[Key])

    def head_object(self, Bucket, Key):  # noqa: N803
        if Key not in self.objects:
            raise Missing(Key)
        return {"ContentLength": len(self.objects[Key])}

    def delete_object(self, Bucket, Key):  # noqa: N803
        self.objects.pop(Key, None)

    def generate_presigned_url(self, operation, Params, ExpiresIn):  # noqa: N803
        disposition = Params.get("ResponseContentDisposition", "")
        return f"https://bucket.example/{Params['Key']}?expires={ExpiresIn}&cd={disposition}"


@pytest.fixture
def bucket(monkeypatch):
    """A configured bucket that never leaves the process."""
    fake = FakeS3()
    monkeypatch.setenv("S3_BUCKET", "test-bucket")
    monkeypatch.setattr(storage, "client", lambda: fake)
    storage.reset()
    yield fake
    storage.reset()


@pytest.fixture
def source(tmp_path):
    path = tmp_path / "Recording_20.m4a"
    path.write_bytes(b"audio bytes")
    return path


# ------------------------------------------------------------------- absent
def test_no_bucket_means_every_call_is_a_no_op(source, tmp_path):
    """The whole of the disabled path: nothing configured, nothing attempted."""
    assert storage.enabled() is False
    assert storage.mirror("k", source) is False
    assert storage.mirror_once("k", source) is False
    assert storage.exists("k") is False
    assert storage.fetch("k", tmp_path / "back.m4a") is False


def test_without_a_bucket_ensure_local_only_asks_the_filesystem(source, tmp_path):
    assert storage.ensure_local("k", source) is True
    assert storage.ensure_local("k", tmp_path / "gone.m4a") is False


# --------------------------------------------------------------------- keys
def test_keys_are_prefixed_by_what_they_hold():
    assert storage.recording_key("Recording_20.m4a") == "recordings/Recording_20.m4a"
    assert storage.playback_key("Recording_20.m4a") == "playback/Recording_20.mp3"
    assert storage.output_key("7122(4)", "7122(4).pdf") == "outputs/7122(4)/7122(4).pdf"


def test_a_key_cannot_carry_a_directory_out_of_its_prefix():
    """The filename reaches here from an upload, so it is not ours to trust."""
    assert storage.recording_key("../../etc/passwd") == "recordings/passwd"
    assert storage.output_key("x", "a/b/c.pdf") == "outputs/x/c.pdf"


def test_content_types_do_not_depend_on_the_machine_that_uploaded(tmp_path):
    """An object is stamped once and served with that type forever.

    Both of these come back wrong from `mimetypes` on Windows, where the
    registry answers: a CSV as an Excel document, a WebM as video.
    """
    assert storage.content_type(tmp_path / "a.csv") == "text/csv"
    assert storage.content_type(tmp_path / "a.webm") == "audio/webm"
    assert storage.content_type(tmp_path / "a.pdf") == "application/pdf"
    assert storage.content_type(tmp_path / "a.m4a") == "audio/mp4"
    assert storage.content_type(tmp_path / "a.qqq") == "application/octet-stream"


def test_the_hash_is_the_hash_of_the_file(source):
    assert storage.sha256_of(source) == hashlib.sha256(b"audio bytes").hexdigest()


# ------------------------------------------------------------------- moving
def test_a_file_comes_back_the_way_it_went_up(bucket, source, tmp_path):
    storage.put("recordings/r.m4a", source)

    back = tmp_path / "pulled" / "r.m4a"
    assert storage.fetch("recordings/r.m4a", back) is True
    assert back.read_bytes() == b"audio bytes"
    assert bucket.types["recordings/r.m4a"] == "audio/mp4"


def test_a_bucket_that_fails_does_not_fail_the_run(bucket, source):
    """The durability copy is not the work. See the module docstring."""
    bucket.fail = True

    assert storage.mirror("recordings/r.m4a", source) is False


def test_a_failed_fetch_leaves_nothing_that_could_be_mistaken_for_the_file(bucket, tmp_path):
    destination = tmp_path / "missing.m4a"

    assert storage.fetch("recordings/nope.m4a", destination) is False
    assert not destination.exists()
    assert list(tmp_path.glob(".*")) == []


def test_ensure_local_pulls_only_what_is_not_here(bucket, source, tmp_path):
    storage.put("recordings/r.m4a", source)
    here = tmp_path / "here.m4a"
    here.write_bytes(b"already")

    assert storage.ensure_local("recordings/r.m4a", here) is True
    assert here.read_bytes() == b"already"  # not overwritten

    pulled = tmp_path / "pulled.m4a"
    assert storage.ensure_local("recordings/r.m4a", pulled) is True
    assert pulled.read_bytes() == b"audio bytes"


def test_the_second_ask_does_not_upload_again(bucket, source):
    assert storage.mirror_once("recordings/r.m4a", source) is True
    assert storage.mirror_once("recordings/r.m4a", source) is True

    assert bucket.uploads == 1


def test_an_object_deleted_underneath_us_is_put_back(bucket, source):
    storage.mirror_once("recordings/r.m4a", source)
    bucket.delete_object("test-bucket", "recordings/r.m4a")

    assert storage.mirror_once("recordings/r.m4a", source) is True
    assert bucket.uploads == 2


def test_a_signed_link_names_the_file_and_expires(bucket, source):
    storage.put("outputs/7122/7122.pdf", source)

    inline = storage.presign("outputs/7122/7122.pdf", filename="7122.pdf")
    attached = storage.presign("outputs/7122/7122.pdf", filename="7122.pdf", download=True)

    assert f"expires={storage.LINK_SECONDS}" in inline
    assert 'inline; filename="7122.pdf"' in inline
    assert 'attachment; filename="7122.pdf"' in attached


def test_the_round_trip_check_cleans_up_after_itself(bucket):
    message = storage.check()

    assert "test-bucket" in message
    assert bucket.objects == {}


def test_the_check_says_what_to_set_when_nothing_is_configured():
    with pytest.raises(storage.StorageError, match="S3_BUCKET"):
        storage.check()


# ------------------------------------------------------- what the app stores
def test_a_finished_inspection_puts_its_outputs_in_the_bucket(
    bucket, client, template, style_sets, stub_pipeline
):
    job = _finish(client)

    assert f"recordings/{job['filename']}" in bucket.objects
    outputs = [key for key in bucket.objects if key.startswith("outputs/")]
    assert all(key.startswith(f"outputs/{job['name']}/") for key in outputs)
    # Every download the browser is offered has a copy behind it.
    assert len(outputs) == len(job["downloads"])
    assert f"outputs/{job['name']}/{job['name']}.json" in bucket.objects
    assert f"outputs/{job['name']}/{job['name']}.pdf" in bucket.objects


def test_a_download_is_served_by_the_bucket_not_the_app(
    bucket, client, template, style_sets, stub_pipeline
):
    """The point of the bucket: the app hands out a link, not the bytes."""
    job = _finish(client)

    response = client.get(f"/api/jobs/{job['id']}/download/report", follow_redirects=False)

    assert response.status_code == 307
    location = unquote(response.headers["location"])
    assert location.startswith("https://bucket.example/outputs/")
    assert 'attachment; filename="Recording_20.pdf"' in location


def test_a_download_still_works_with_no_bucket(client, template, style_sets, stub_pipeline):
    job = _finish(client)

    response = client.get(f"/api/jobs/{job['id']}/download/report")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"


def test_a_report_whose_disk_copy_is_gone_is_still_downloadable(
    bucket, client, template, style_sets, stub_pipeline
):
    """The machine that produced it is not the machine answering for it."""
    from api import app as api_module

    job = _finish(client)
    api_module.store.get(job["id"]).files["report"].unlink()

    response = client.get(f"/api/jobs/{job['id']}/download/report", follow_redirects=False)

    assert response.status_code == 307


def test_the_recording_is_noted_where_the_registry_can_see_it(bucket, source, monkeypatch):
    """A store that keeps rows is told the key and the hash; one that does not
    is simply not asked."""
    noted = {}

    class Registry:
        def record_recording(self, job, key, sha256=""):
            noted.update(job=job, key=key, sha256=sha256)

    job = jobs.Job(id="abc", filename=source.name)
    jobs._archive_recording(job, source, Registry())

    assert noted["key"] == "recordings/Recording_20.m4a"
    assert noted["sha256"] == hashlib.sha256(b"audio bytes").hexdigest()
    jobs._archive_recording(job, source, jobs.JobStore())  # no record_recording; must not raise


def test_reading_the_real_env_file_cannot_re_enable_production(source):
    """The guard in conftest, proven rather than assumed.

    `Settings.load()` calls `load_env_file()`, which reads the real `.env` and
    fills in anything the environment does not already have. If conftest had
    deleted these variables instead of blanking them, that call would hand the
    suite the live bucket and the live database — and the first test to upload
    would write a fixture into the client's documents.

    Trivially true on a machine with no `.env`; the point is the machine that
    has one.
    """
    from services.config import Settings, load_env_file
    from services.db.session import database_url

    load_env_file()

    assert storage.bucket() == ""
    assert storage.enabled() is False
    assert database_url() == ""
    assert storage.mirror(storage.recording_key(source.name), source) is False
    # The rest of the configuration still loads, so this guard costs nothing.
    assert Settings.load().data_dir
