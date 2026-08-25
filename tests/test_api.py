"""The web app, exercised with the pipeline stubbed out."""

import pytest
from fastapi.testclient import TestClient

import pipeline
from api import app as api
from api.jobs import DONE, FAILED, JobStore, process
from services.csv_filler import InspectionSheet

from .conftest import SHEET_PAYLOAD


@pytest.fixture
def client(settings, monkeypatch):
    """A test client whose uploads land in the throwaway data directory."""
    api.app.dependency_overrides[api.settings_dependency] = lambda: settings
    monkeypatch.setattr(api, "store", JobStore())
    with TestClient(api.app) as test_client:
        yield test_client
    api.app.dependency_overrides.clear()


@pytest.fixture
def stub_pipeline(monkeypatch):
    """Replace the two API-backed stages so uploads process offline."""
    monkeypatch.setattr(
        pipeline.inspection_pipeline,
        "transcribe_recording",
        lambda recording, settings, client=None, on_delta=None, announce=None: "text",
    )
    monkeypatch.setattr(
        pipeline.inspection_pipeline,
        "extract_inspection",
        lambda transcript, settings, template, client=None: InspectionSheet.from_payload(
            SHEET_PAYLOAD
        ),
    )


def upload(client, name="Recording_20.m4a", content=b"audio bytes", style_no=None):
    data = {"style_no": style_no} if style_no is not None else None
    return client.post("/api/jobs", files={"recording": (name, content, "audio/mp4")}, data=data)


def test_style_sets_are_listed_for_the_dropdown(client, style_sets):
    assert client.get("/api/style-sets").json() == ["7270"]


def test_style_sets_list_is_empty_without_any(client):
    assert client.get("/api/style-sets").json() == []


def test_the_chosen_style_reaches_the_job(client, template, style_sets, stub_pipeline):
    body = upload(client, style_no="7270").json()

    assert body["style_no"] == "7270"
    assert client.get(f"/api/jobs/{body['id']}").json()["style_no"] == "7270"


def test_choosing_a_style_with_no_sheet_is_refused(client, template, style_sets, settings):
    """Better to say so at upload than to transcribe and then find nothing to check."""
    response = upload(client, style_no="1234")

    assert response.status_code == 404
    assert "no style set for style 1234" in response.json()["detail"]
    assert list(settings.recordings_dir.glob("*.m4a")) == []


def test_no_style_chosen_falls_back_to_the_recording(client, template, stub_pipeline):
    assert upload(client).json()["style_no"] == ""


def test_index_serves_the_page(client):
    response = client.get("/")

    assert response.status_code == 200
    assert "Size Set Inspection Reports" in response.text


def test_index_is_not_cached(client):
    """A stale cached page is indistinguishable from an edit that did not work."""
    assert "no-store" in client.get("/").headers["cache-control"]


def test_upload_queues_a_job_and_returns_it(client, template, stub_pipeline):
    response = upload(client)

    assert response.status_code == 202
    body = response.json()
    assert body["filename"] == "Recording_20.m4a"
    assert body["id"]


def test_upload_runs_the_pipeline_and_offers_downloads(client, template, stub_pipeline):
    job_id = upload(client).json()["id"]

    body = client.get(f"/api/jobs/{job_id}").json()

    assert body["status"] == DONE
    assert body["rows"] == 5
    assert body["flagged"] == 2
    assert body["downloads"] == ["data", "form", "measurements", "report"]


def test_a_finished_job_carries_enough_detail_to_review_on_screen(client, template, stub_pipeline):
    """The page shows flagged values without downloading the report."""
    job_id = upload(client).json()["id"]

    body = client.get(f"/api/jobs/{job_id}").json()

    assert body["accessories"] == 3
    assert body["comments"] == 2
    assert body["form"]["style_no"] == "7270"
    assert [row["no"] for row in body["flagged_rows"]] == [3, 5]
    assert body["flagged_rows"][0]["field"] == "Side seam tie length"
    assert body["flagged_rows"][0]["confidence"] == 0.55


def test_flagged_detail_is_capped(client, template, monkeypatch, stub_pipeline):
    """A poll must not turn into a full report download."""
    monkeypatch.setattr("api.jobs.MAX_FLAGGED_DETAIL", 1)

    job_id = upload(client).json()["id"]

    body = client.get(f"/api/jobs/{job_id}").json()
    assert body["flagged"] == 2  # the count is still the true one
    assert len(body["flagged_rows"]) == 1


def test_elapsed_is_reported(client, template, stub_pipeline):
    job_id = upload(client).json()["id"]

    assert client.get(f"/api/jobs/{job_id}").json()["elapsed"] >= 0


@pytest.mark.parametrize(
    ("kind", "content_type"),
    [("report", "application/pdf"), ("form", "text/csv"), ("data", "application/json")],
)
def test_each_output_downloads(client, template, stub_pipeline, kind, content_type):
    job_id = upload(client).json()["id"]

    response = client.get(f"/api/jobs/{job_id}/download/{kind}")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(content_type)
    assert response.content


def test_report_download_is_a_pdf(client, template, stub_pipeline):
    job_id = upload(client).json()["id"]

    response = client.get(f"/api/jobs/{job_id}/download/report")

    assert response.content.startswith(b"%PDF")


def test_upload_rejects_a_non_audio_file(client, template):
    response = upload(client, name="notes.pdf", content=b"%PDF")

    assert response.status_code == 415
    assert "unsupported file type" in response.json()["detail"]


def test_upload_rejects_a_file_with_no_extension(client, template):
    response = upload(client, name="recording", content=b"audio")

    assert response.status_code == 415


def test_upload_rejects_a_recording_beyond_the_upload_ceiling(client, template, monkeypatch):
    monkeypatch.setattr(api, "MAX_RECORDING_BYTES", 8)

    response = upload(client, content=b"far too many bytes for this limit")

    assert response.status_code == 413
    assert "over the" in response.json()["detail"]


def test_an_oversized_upload_is_not_left_on_disk(client, settings, template, monkeypatch):
    monkeypatch.setattr(api, "MAX_RECORDING_BYTES", 8)

    upload(client, content=b"far too many bytes for this limit")

    assert list(settings.recordings_dir.glob("*")) == []


def test_a_recording_over_the_api_limit_is_still_accepted(
    client, template, stub_pipeline, monkeypatch
):
    """The pipeline re-encodes it, so the browser must not refuse it first.

    Rejecting here is what made the CLI accept a 46 MB recording while the web
    app turned away a 27 MB one.
    """
    monkeypatch.setattr(api, "MAX_UPLOAD_BYTES", 8)

    response = upload(client, content=b"bigger than the transcription limit")

    assert response.status_code == 202


def test_a_path_traversing_filename_is_stripped(client, settings, template, stub_pipeline):
    """The browser supplies the name, so only its last component may be used."""
    upload(client, name="../../evil.m4a")

    assert (settings.recordings_dir / "evil.m4a").is_file()
    assert not (settings.data_dir.parent / "evil.m4a").exists()


def test_a_second_upload_of_the_same_name_does_not_overwrite(client, settings, template):
    upload(client)
    upload(client)

    names = sorted(path.name for path in settings.recordings_dir.glob("*.m4a"))
    assert names == ["Recording_20(1).m4a", "Recording_20.m4a"]


def test_unknown_job_is_a_404(client):
    assert client.get("/api/jobs/nope").status_code == 404
    assert client.get("/api/jobs/nope/download/report").status_code == 404


def test_unknown_download_kind_is_a_404(client, template, stub_pipeline):
    job_id = upload(client).json()["id"]

    assert client.get(f"/api/jobs/{job_id}/download/nonsense").status_code == 404


def test_downloading_before_the_job_finishes_is_a_409(client, settings, template):
    job = api.store.create("pending.m4a")

    response = client.get(f"/api/jobs/{job.id}/download/report")

    assert response.status_code == 409
    assert "not ready" in response.json()["detail"]


def test_a_deleted_output_reports_gone(client, template, stub_pipeline):
    job_id = upload(client).json()["id"]
    api.store.get(job_id).files["report"].unlink()

    assert client.get(f"/api/jobs/{job_id}/download/report").status_code == 410


def test_jobs_are_listed_newest_first(client, template, stub_pipeline):
    upload(client, name="first.m4a")
    upload(client, name="second.m4a")

    listed = [job["filename"] for job in client.get("/api/jobs").json()]

    assert listed == ["second.m4a", "first.m4a"]


def test_a_failing_pipeline_marks_the_job_failed_not_the_process(settings, recording):
    """A background task must record its failure, never take the server down."""
    store = JobStore()
    job = store.create(recording.name)

    process(job, recording, settings, store)  # no template in this settings dir

    assert job.status == FAILED
    assert job.error


def test_progress_messages_reach_the_job(settings, recording, template, stub_pipeline):
    store = JobStore()
    job = store.create(recording.name)

    process(job, recording, settings, store)

    assert job.status == DONE
    assert "need review" in job.message
