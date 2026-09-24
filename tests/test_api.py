"""The web app, exercised with the pipeline stubbed out."""

from dataclasses import replace

import pytest

import pipeline
from api import app as api
from api.jobs import DONE, FAILED, JobStore, process
from services.csv_filler import InspectionSheet

from .conftest import SHEET_PAYLOAD
from .style_set_fixture import write_style_set


def upload(client, name="Recording_20.m4a", content=b"audio bytes", style_no=None, stage=None):
    data = {}
    if style_no is not None:
        data["style_no"] = style_no
    if stage is not None:
        data["stage"] = stage
    return client.post(
        "/api/jobs", files={"recording": (name, content, "audio/mp4")}, data=data or None
    )


def _finish(client, style_no="7270"):
    """Upload, then read the finished job back."""
    body = upload(client, style_no=style_no).json()
    return client.get(f"/api/jobs/{body['id']}").json()


def test_a_graded_job_reports_the_check_against_spec(client, template, style_sets, stub_pipeline):
    """The browser has to show the spec check, or it is invisible to the operator."""
    job = _finish(client)

    assert job["graded"] is True
    assert job["graded_style_no"] == "7270"
    assert job["measurement_result"] == "FAIL CONDITIONALLY"
    assert job["judged"] == 2
    assert job["out_of_tolerance"] == 1
    assert job["failed_rows"][0]["pom"]
    assert job["failed_rows"][0]["deviation"]


def test_the_graded_sheet_is_downloadable(client, template, style_sets, stub_pipeline):
    job = _finish(client)

    assert {"graded", "graded_data"} <= set(job["downloads"])
    pdf = client.get(f"/api/jobs/{job['id']}/download/graded")
    csv = client.get(f"/api/jobs/{job['id']}/download/graded_data")

    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert csv.status_code == 200
    assert b"UNCONFIRMED" in csv.content or b"pom" in csv.content


def test_a_verdict_the_recording_never_gave_reaches_the_browser(
    client, template, style_sets, monkeypatch
):
    """The costly case, end to end through the web path.

    A point of measure the recording never ruled on must not reach the operator
    looking like a pass. It has to arrive as an open question with the POM, the
    size and the spec, so it can be listened back to.
    """
    silent = {
        "form": dict(SHEET_PAYLOAD["form"]),
        "accessories": [],
        "comments": [],
        "rows": [
            {
                "section": "measurement",
                "size": "M",
                "field": "Front length from HPS - NK seam",
                "value": "32 3/4",
                "deviation": "",
                "verdict": "not stated",
                "note": "",
                "confidence": 1.0,
            }
        ],
    }
    monkeypatch.setattr(
        pipeline.inspection_pipeline,
        "transcribe_recording",
        lambda recording, settings, client=None, on_delta=None, announce=None: "text",
    )
    monkeypatch.setattr(
        pipeline.inspection_pipeline,
        "extract_inspection",
        lambda transcript, settings, template, client=None: InspectionSheet.from_payload(silent),
    )

    job = _finish(client)

    assert job["unconfirmed"] == 1
    assert job["measurement_result"] == "UNVERIFIED - 1 CHECK OUTSTANDING"
    open_question = job["unconfirmed_rows"][0]
    assert open_question["pom"] == "1.01C"
    assert open_question["size"] == "M"
    assert open_question["spec"] == "32 3/4"
    assert "no verdict" in job["message"] or "not captured" in job["message"]


def test_a_job_with_no_style_set_says_which_style_was_announced(client, template, stub_pipeline):
    """Without a sheet nothing was checked, and the operator needs to know why."""
    job = _finish(client, style_no=None)

    assert job["graded"] is False
    assert job["announced_style_no"] == "7270"
    assert job["unconfirmed"] == 0
    assert "graded" not in job["downloads"]


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
    """The app shell, whichever one is on disk.

    A checkout that has never run `npm run build` gets the legacy single-file
    page; one that has gets the React shell. Both are the product, so this
    asserts on the mount point they share rather than on a title that belongs
    to the design and is free to change.
    """
    response = client.get("/")

    assert response.status_code == 200
    assert 'id="root"' in response.text or "Size Set Inspection" in response.text


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


@pytest.mark.parametrize("name", ["inspection-2026-09-09-143012.webm", "inspection.mp4"])
def test_a_browser_recording_is_accepted(client, template, stub_pipeline, name):
    """What the in-browser recorder produces must upload like any other file.

    MediaRecorder gives webm/opus on Chrome, Edge and Firefox and mp4/aac on
    Safari, and nothing else. Dropping either from AUDIO_SUFFIXES would break
    the record button while every other test still passed.
    """
    response = upload(client, name=name, content=b"recorded bytes")

    assert response.status_code == 202
    assert response.json()["filename"] == name


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


def test_an_upload_is_filed_under_a_stage(client, template, stub_pipeline):
    """Size set by default, and the stage travels back on the job."""
    assert upload(client).json()["stage"] == "sizeset"
    assert upload(client, name="b.m4a", stage="sizeset").json()["stage"] == "sizeset"


def test_a_stage_with_no_pipeline_refuses_a_recording(client, template, stub_pipeline):
    """The refusal this product turns on.

    PPM, Interim and Final are real stages with real roles and demo data on
    screen. What they do not have is a pipeline — so a recording filed under
    one would be run through the size-set extractor and come back looking like
    a graded report for a check nobody performed.
    """
    response = upload(client, stage="final")

    assert response.status_code == 409
    assert "no pipeline yet" in response.json()["detail"]
    # And nothing was queued behind the refusal.
    assert not [job for job in api.store.all() if job.stage == "final"]


def test_an_unknown_stage_is_refused(client, template, stub_pipeline):
    assert upload(client, stage="nonsense").status_code == 422


def test_jobs_can_be_narrowed_to_one_stage(client, template, stub_pipeline):
    upload(client, name="one.m4a")

    assert [job["filename"] for job in client.get("/api/jobs?stage=sizeset").json()] == [
        "one.m4a"
    ]
    assert client.get("/api/jobs?stage=final").json() == []
    # Unfiltered still answers for the whole floor, which is what the dashboard
    # counts across.
    assert len(client.get("/api/jobs").json()) == 1


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


def test_a_live_transcript_is_saved_beside_the_recording(client, template, settings, stub_pipeline):
    """The monitor's text is the only record of what was heard as it happened."""
    from services.transcript import live_transcript_path_for

    heard = "size large, front length twenty two one eight, minus one by eight"
    client.post(
        "/api/jobs",
        files={"recording": ("rec.m4a", b"audio bytes", "audio/mp4")},
        data={"style_no": "", "live_transcript": heard},
    )

    saved = live_transcript_path_for(settings.recordings_dir / "rec.m4a", settings)
    assert saved.read_text(encoding="utf-8") == heard


def test_a_live_transcript_never_reaches_the_pipeline(client, template, settings, stub_pipeline):
    """It is a latency-tuned monitor, so it must not become the report's source.

    The batch transcript is what the extractor reads. If the live text ever fed
    it, a verdict the monitor dropped would come back as an unspoken pass — the
    exact failure the two-pass design exists to prevent.
    """
    client.post(
        "/api/jobs",
        files={"recording": ("rec.m4a", b"audio bytes", "audio/mp4")},
        data={"live_transcript": "monitor text only"},
    )

    batch = settings.transcripts_dir / "rec.txt"
    assert batch.read_text(encoding="utf-8") == "text"  # from the stubbed transcriber


def test_no_live_transcript_writes_no_file(client, template, settings, stub_pipeline):
    from services.transcript import live_transcript_path_for

    upload(client, name="rec.m4a")

    assert not live_transcript_path_for(settings.recordings_dir / "rec.m4a", settings).exists()


def test_the_realtime_token_carries_the_garment_vocabulary(client, monkeypatch):
    """The live session carries the settings the API actually honours.

    Only model, prompt and languages survive: `keywords` and `delay` are
    accepted without complaint and echoed back as null, measured both on the
    minted token and on session.updated. Sending them anyway would read like a
    working vocabulary boost that is not there, so they must stay out.
    """
    from api.app import LIVE_PROMPT
    from services.transcript import DOMAIN_PROMPT

    sent = {}

    class FakeSecrets:
        def create(self, **kwargs):
            sent.update(kwargs)
            return type("Secret", (), {"value": "ek_test"})()

    class FakeClient:
        def __init__(self, api_key):
            self.realtime = type("R", (), {"client_secrets": FakeSecrets()})()

    monkeypatch.setattr("openai.OpenAI", FakeClient)
    body = client.post("/api/realtime-token").json()

    assert body["value"] == "ek_test"
    assert body["model"] == "gpt-live-transcribe"
    transcription = sent["session"]["audio"]["input"]["transcription"]
    # The shared prompt, plus the one nudge the live monitor needs on top of it.
    assert transcription["prompt"] == LIVE_PROMPT
    assert LIVE_PROMPT.startswith(DOMAIN_PROMPT)
    assert transcription["languages"] == ["hi", "en"]
    assert "keywords" not in transcription
    assert "delay" not in transcription
    # Turn detection is refused outright for this model; asking for it 400s the
    # whole request, so the live session must never include it.
    assert "turn_detection" not in sent["session"]["audio"]["input"]
    assert sent["expires_after"]["seconds"] > 0


def test_the_live_nudge_names_no_script_and_stays_off_the_batch_passes():
    """Two things this prompt must not do, both measured the hard way.

    Naming Devanagari makes the mis-scripting worse rather than better - 7 of 8
    runs against 4 of 8 - because the model reads the prompt as a hint about
    which script to WRITE in. And the batch passes, which are what the report
    is built from, must keep the shared prompt untouched.
    """
    from api.app import LIVE_PROMPT
    from services.transcript import DOMAIN_PROMPT

    added = LIVE_PROMPT[len(DOMAIN_PROMPT) :]
    assert added.strip(), "the live monitor adds something to the shared prompt"
    for script in ("Devanagari", "Latin", "Cyrillic", "Katakana"):
        assert script not in added, f"naming {script} made it measurably worse"
    assert DOMAIN_PROMPT != LIVE_PROMPT


def test_the_realtime_token_never_returns_the_account_key(client, monkeypatch, settings):
    """A leaked ephemeral secret expires; a leaked account key does not."""

    class FakeSecrets:
        def create(self, **kwargs):
            return type("Secret", (), {"value": "ek_ephemeral"})()

    class FakeClient:
        def __init__(self, api_key):
            self.realtime = type("R", (), {"client_secrets": FakeSecrets()})()

    monkeypatch.setattr("openai.OpenAI", FakeClient)
    text = client.post("/api/realtime-token").text

    assert settings.openai_api_key not in text


def test_live_transcription_can_be_turned_off(client, settings, monkeypatch):
    """An operator with no realtime access should get a plain answer, not a 500."""
    monkeypatch.setattr(api.app, "dependency_overrides", api.app.dependency_overrides)
    api.app.dependency_overrides[api.settings_dependency] = lambda: replace(
        settings, realtime_model=""
    )

    response = client.post("/api/realtime-token")

    assert response.status_code == 503
    assert "live transcription is off" in response.json()["detail"]


def test_a_refused_realtime_session_is_reported_not_swallowed(client, monkeypatch):
    class FakeSecrets:
        def create(self, **kwargs):
            raise RuntimeError("model not available for this account")

    class FakeClient:
        def __init__(self, api_key):
            self.realtime = type("R", (), {"client_secrets": FakeSecrets()})()

    monkeypatch.setattr("openai.OpenAI", FakeClient)
    response = client.post("/api/realtime-token")

    assert response.status_code == 502
    assert "model not available" in response.json()["detail"]


def _graded_job(client):
    """A finished, graded job whose extraction is on disk to be settled."""
    job = _finish(client, style_no="7270")
    assert job["graded"], "the audit view needs a job that was checked against a sheet"
    return job


def test_the_graded_sheet_is_served_as_a_grid(client, template, style_sets, stub_pipeline):
    """The audit view renders the client's document, so it has to be served whole."""
    job = _graded_job(client)
    grid = client.get(f"/api/jobs/{job['id']}/sheet").json()

    assert grid["style_no"] == "7270"
    assert grid["sizes"]
    assert {row["kind"] for row in grid["rows"]} <= {"pom", "note"}
    measured = [row for row in grid["rows"] if row["kind"] == "pom"]
    assert measured, "a graded sheet with no points of measure is not a graded sheet"
    assert all(set(row["cells"]) == set(grid["sizes"]) for row in measured)


def test_an_ungraded_job_says_why_there_is_nothing_to_audit(client, template, stub_pipeline):
    """No spec sheet means no graded sheet. Say so rather than serving an empty grid."""
    job = _finish(client, style_no="")
    response = client.get(f"/api/jobs/{job['id']}/sheet")

    assert response.status_code == 409
    assert "spec sheet" in response.json()["detail"]


def test_settling_a_cell_rebuilds_the_report(client, template, style_sets, stub_pipeline):
    """The extraction is the source of truth, so an edit and a re-render is the
    whole loop — no transcription, no model call, and the verdict moves with it."""
    job = _graded_job(client)
    grid = client.get(f"/api/jobs/{job['id']}/sheet").json()
    target = next(row for row in grid["rows"] if row["kind"] == "pom" and row["measured_here"])
    size = next(
        (s for s, cell in target["cells"].items() if cell["state"] != "empty"),
        grid["sizes"][0],
    )

    response = client.post(
        f"/api/jobs/{job['id']}/sheet",
        json={"edits": [{"sheet_index": target["sheet_index"], "size": size,
                         "deviation": "+1/8", "verdict": "deviation"}]},
    )
    assert response.status_code == 200
    body = response.json()

    assert body["misplaced"] == [], "a settled cell must come back on the row it was entered on"
    assert body["job"]["status"] == DONE
    settled = next(
        row["cells"][size]
        for row in body["sheet"]["rows"]
        if row.get("sheet_index") == target["sheet_index"]
    )
    assert settled["edited"] is True
    assert settled["deviation"] == "+1/8"
    assert len(body["sheet"]["corrections"]) == 1
    # And the downloads were rewritten from it, not left describing the old run.
    assert body["job"]["downloads"]


def test_an_empty_edit_is_refused(client, template, style_sets, stub_pipeline):
    """A save that changes nothing must not rewrite a vendor-facing report."""
    job = _graded_job(client)
    assert client.post(f"/api/jobs/{job['id']}/sheet", json={"edits": []}).status_code == 400
    assert client.post(f"/api/jobs/{job['id']}/sheet", json={}).status_code == 400
    bad = client.post(f"/api/jobs/{job['id']}/sheet", json={"edits": [{"size": "M"}]})
    assert bad.status_code == 400
    assert "sheet_index" in bad.json()["detail"]


def test_the_audit_endpoints_refuse_a_job_that_does_not_exist(client):
    assert client.get("/api/jobs/nope/sheet").status_code == 404
    assert client.post("/api/jobs/nope/sheet", json={"edits": [1]}).status_code == 404


def test_api_answers_are_never_cached(client):
    """404 and 410 are cacheable by default, and both are transient here.

    A graded sheet that was briefly missing stayed missing in the browser long
    after the server could serve it again, and nothing on screen said the fault
    had already been fixed.
    """
    for path in ("/api/jobs", "/api/style-sets", "/api/jobs/nope"):
        response = client.get(path)
        assert "no-store" in response.headers.get("cache-control", ""), path


# ------------------------------------------------------------- the style library
def _sheet_bytes(tmp_path, style_no="7270"):
    """A stand-in graded sheet, as the bytes a browser would post."""
    return write_style_set(tmp_path / "upload.pdf", style_no=style_no).read_bytes()


def _post_sheet(client, payload, name="graded.pdf", replace=False):
    return client.post(
        "/api/style-sets",
        files={"sheet": (name, payload, "application/pdf")},
        data={"replace": "true"} if replace else None,
    )


def test_an_uploaded_sheet_is_graded_against(client, template, tmp_path, stub_pipeline):
    """The whole point of the upload: no `style_sets` fixture here, so the only
    sheet in the library is the one that arrived over HTTP."""
    added = _post_sheet(client, _sheet_bytes(tmp_path))

    assert added.status_code == 201, added.text
    assert added.json()["style_no"] == "7270"
    assert added.json()["poms"] > 0
    assert client.get("/api/style-sets").json() == ["7270"]

    # and the very next recording is checked against it, with nothing restarted
    job = _finish(client)
    assert job["graded"] is True
    assert job["graded_style_no"] == "7270"


def test_the_style_number_comes_out_of_the_document(client, tmp_path):
    """Not off the filename. A sheet filed under the wrong number grades every
    measurement against the wrong spec and never looks wrong doing it."""
    added = _post_sheet(client, _sheet_bytes(tmp_path, "8123"), name="style_9999.pdf")

    assert added.status_code == 201, added.text
    assert added.json()["style_no"] == "8123"
    assert client.get("/api/style-sets").json() == ["8123"]


def test_a_sheet_that_cannot_be_read_is_refused(client):
    refused = _post_sheet(client, b"this is not a PDF at all")

    assert refused.status_code == 422
    assert "could not be read" in refused.json()["detail"]
    assert client.get("/api/style-sets").json() == []


def test_only_pdfs(client, tmp_path):
    wrong = _post_sheet(client, _sheet_bytes(tmp_path), name="sheet.xlsx")

    assert wrong.status_code == 415
    assert client.get("/api/style-sets").json() == []


def test_an_existing_style_is_not_overwritten_by_accident(client, tmp_path, style_sets):
    """`style_sets` already put 7270 in the library."""
    clash = _post_sheet(client, _sheet_bytes(tmp_path))

    assert clash.status_code == 409
    assert "already in the library" in clash.json()["detail"]

    replaced = _post_sheet(client, _sheet_bytes(tmp_path), replace=True)
    assert replaced.status_code == 201, replaced.text
    assert client.get("/api/style-sets").json() == ["7270"]


def test_the_library_reads_what_is_inside_each_sheet(client, tmp_path):
    """The screen's columns come out of the PDF. A library that lists style
    numbers and nothing else cannot tell you which sheet you are about to
    grade against."""
    assert _post_sheet(client, _sheet_bytes(tmp_path)).status_code == 201

    library = client.get("/api/style-sets/sheets").json()

    assert len(library) == 1
    sheet = library[0]
    assert sheet["style_no"] == "7270"
    assert sheet["readable"] is True
    assert sheet["poms"] > 0
    assert sheet["sizes"]
    assert sheet["base_size"] in sheet["sizes"]
    assert sheet["last_used"] is None  # nothing has been graded against it yet


def test_a_sheet_that_will_not_parse_is_listed_rather_than_hidden(client, settings, tmp_path):
    """A sheet nobody can see is a sheet nobody fixes — and the first anyone
    would hear of it is a recording that will not grade."""
    settings.style_sets_dir.mkdir(parents=True, exist_ok=True)
    (settings.style_sets_dir / "style_4141.pdf").write_bytes(b"not really a PDF")

    library = client.get("/api/style-sets/sheets").json()

    assert [sheet["readable"] for sheet in library] == [False]
    assert library[0]["document"] == "style_4141.pdf"


def test_the_sheet_detail_carries_the_graded_specification(client, tmp_path):
    _post_sheet(client, _sheet_bytes(tmp_path))

    sheet = client.get("/api/style-sets/sheets/7270").json()

    assert sheet["rows"], "the dialog shows the whole spec, not a summary"
    measured = [row for row in sheet["rows"] if any(row["specs"].values())]
    assert measured
    assert set(measured[0]["specs"]) >= set(sheet["sizes"])
    assert client.get("/api/style-sets/sheets/9999").status_code == 404


def test_last_used_points_at_the_inspection_that_used_it(
    client, template, tmp_path, stub_pipeline
):
    _post_sheet(client, _sheet_bytes(tmp_path))
    _finish(client)

    sheet = client.get("/api/style-sets/sheets").json()[0]

    assert sheet["last_used"] is not None


def test_a_sheet_can_be_taken_out_of_the_library(client, tmp_path):
    _post_sheet(client, _sheet_bytes(tmp_path))

    removed = client.delete("/api/style-sets/sheets/7270")

    assert removed.status_code == 200
    assert client.get("/api/style-sets/sheets").json() == []
    assert client.get("/api/style-sets").json() == []


def test_the_buyers_own_document_is_downloadable(client, tmp_path):
    _post_sheet(client, _sheet_bytes(tmp_path))

    pdf = client.get("/api/style-sets/sheets/7270/pdf")

    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")


# ------------------------------------------------------------- the audit trail
def test_recording_an_inspection_is_written_down(client, template, style_sets, stub_pipeline):
    upload(client, style_no="7270")

    trail = client.get("/api/activity").json()

    assert len(trail) == 1
    assert trail[0]["kind"] == "record"
    assert "Recorded an inspection" in trail[0]["what"]
    # Attributed to the signed-in account, by name, not by id.
    assert trail[0]["actor"]
    assert trail[0]["user_id"]


def test_the_machine_working_is_not_an_event(client, template, style_sets, stub_pipeline):
    """Transcription, grading and writing files are the inspection's own
    progress. A log that records them buries the corrections."""
    _finish(client)

    kinds = [event["kind"] for event in client.get("/api/activity").json()]

    assert kinds == ["record"]


def test_a_correction_is_attributed(client, template, style_sets, stub_pipeline):
    job = _graded_job(client)
    grid = client.get(f"/api/jobs/{job['id']}/sheet").json()
    target = next(row for row in grid["rows"] if row["kind"] == "pom" and row["measured_here"])
    size = next(
        (s for s, cell in target["cells"].items() if cell["state"] != "empty"),
        grid["sizes"][0],
    )
    settled = client.post(
        f"/api/jobs/{job['id']}/sheet",
        json={
            "edits": [
                {
                    "sheet_index": target["sheet_index"],
                    "size": size,
                    "deviation": "+1/8",
                    "verdict": "deviation",
                }
            ]
        },
    )
    assert settled.status_code == 200, settled.text

    trail = client.get("/api/activity").json()

    assert trail[0]["kind"] == "correction"
    assert "Settled 1 reading by hand" in trail[0]["what"]
    assert trail[0]["actor"]


def test_only_the_copy_that_leaves_the_building_is_logged(
    client, template, style_sets, stub_pipeline
):
    """A working file is downloaded a dozen times while a sheet is being
    settled. The vendor PDF is the one line that matters."""
    job = _finish(client)

    client.get(f"/api/jobs/{job['id']}/download/data")
    before = [event["kind"] for event in client.get("/api/activity").json()]
    client.get(f"/api/jobs/{job['id']}/download/report")
    after = client.get("/api/activity").json()

    assert before == ["record"]
    assert after[0]["kind"] == "access"
    assert "for a vendor" in after[0]["what"]


def test_the_roster_changes_are_written_down(client, tmp_path):
    made = client.post(
        "/api/users",
        json={
            "email": "new.person@example.com",
            "name": "New Person",
            "password": "a good long password",
            "roles": {"sizeset": "inspector"},
        },
    )
    assert made.status_code == 201, made.text

    trail = client.get("/api/activity").json()

    assert trail[0]["kind"] == "access"
    assert "Added New Person to the roster" in trail[0]["what"]
    assert trail[0]["subject"] == "new.person@example.com"


def test_the_trail_survives_the_account_being_removed(client):
    """The snapshot of the name is why. A row that says somebody did something
    is worse than no row at all."""
    made = client.post(
        "/api/users",
        json={
            "email": "briefly@example.com",
            "name": "Briefly Here",
            "password": "a good long password",
            "roles": {"sizeset": "inspector"},
        },
    ).json()
    client.delete(f"/api/users/{made['id']}")

    trail = client.get("/api/activity").json()
    added = [event for event in trail if "Added Briefly Here" in event["what"]]

    assert added, "the event is still there"
    assert added[0]["actor"], "and still says who did it"
