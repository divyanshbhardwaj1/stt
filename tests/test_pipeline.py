"""The pipeline wiring, and main.py's argument handling."""

import pytest

import main
import pipeline
from services.config import ConfigError, Settings
from services.csv_filler import InspectionSheet, TemplateError

from .conftest import SHEET_PAYLOAD


@pytest.fixture
def stub_stages(monkeypatch):
    """Replace the two API-backed stages so the pipeline can run offline."""
    calls = {"transcribed": 0, "extracted": 0}

    def fake_transcribe(recording, settings, client=None, on_delta=None):
        calls["transcribed"] += 1
        if on_delta:
            on_delta("streamed text")
        return "streamed text"

    def fake_extract(transcript, settings, template, client=None):
        calls["extracted"] += 1
        return InspectionSheet.from_payload(SHEET_PAYLOAD)

    monkeypatch.setattr(pipeline.inspection_pipeline, "transcribe_recording", fake_transcribe)
    monkeypatch.setattr(pipeline.inspection_pipeline, "extract_inspection", fake_extract)
    return calls


def test_run_produces_every_output(settings, recording, template, stub_stages):
    result = pipeline.run(recording, settings)

    assert result.name == "Recording_20"
    assert result.form_csv_path.is_file()
    assert result.measurements_csv_path.is_file()
    assert result.pdf_path.is_file()
    assert result.json_path.is_file()
    assert result.flagged_count == 2


def test_run_reuses_an_existing_transcript(settings, recording, template, stub_stages):
    pipeline.run(recording, settings)
    pipeline.run(recording, settings)

    assert stub_stages["transcribed"] == 1  # second run reused the saved transcript
    assert stub_stages["extracted"] == 2


def test_retranscribe_forces_a_fresh_transcription(settings, recording, template, stub_stages):
    pipeline.run(recording, settings)
    pipeline.run(recording, settings, retranscribe=True)

    assert stub_stages["transcribed"] == 2


def test_run_announces_each_stage(settings, recording, template, stub_stages):
    said = []

    pipeline.run(recording, settings, announce=said.append)

    assert any("transcribing" in line for line in said)
    assert any("extracting" in line for line in said)


def test_run_fails_clearly_without_the_form_template(settings, recording, stub_stages):
    settings.form_template_path.unlink(missing_ok=True)

    with pytest.raises(TemplateError, match="report template not found"):
        pipeline.run(recording, settings)


def test_a_second_run_does_not_overwrite_the_first(settings, recording, template, stub_stages):
    first = pipeline.run(recording, settings)
    second = pipeline.run(recording, settings)
    third = pipeline.run(recording, settings)

    assert first.name == "Recording_20"
    assert second.name == "Recording_20(1)"
    assert third.name == "Recording_20(2)"
    assert first.form_csv_path.is_file()  # still there, untouched


def test_every_output_of_a_run_shares_one_version(settings, recording, template, stub_stages):
    pipeline.run(recording, settings)
    second = pipeline.run(recording, settings)

    assert second.form_csv_path.name == "Recording_20(1).csv"
    assert second.measurements_csv_path.name == "Recording_20(1)-measurements.csv"
    assert second.pdf_path.name == "Recording_20(1).pdf"
    assert second.json_path.name == "Recording_20(1).json"


def test_a_version_is_claimed_if_any_of_its_files_exists(
    settings, recording, template, stub_stages
):
    """A leftover PDF alone must still block that version, or files would mismatch."""
    pipeline.run(recording, settings)
    (settings.output_dir / "Recording_20(1).pdf").write_bytes(b"%PDF stale")

    assert pipeline.run(recording, settings).name == "Recording_20(2)"


def test_rerender_overwrites_its_own_version(settings, recording, template, stub_stages):
    pipeline.run(recording, settings)
    pipeline.run(recording, settings)

    result = pipeline.rerender("Recording_20(1)", settings)

    assert result.name == "Recording_20(1)"
    assert not (settings.output_dir / "Recording_20(2).csv").exists()


def test_rerender_rebuilds_without_calling_the_api(settings, recording, template, stub_stages):
    pipeline.run(recording, settings)
    stub_stages["extracted"] = 0

    result = pipeline.rerender("Recording_20", settings)

    assert stub_stages["extracted"] == 0
    assert result.form_csv_path.is_file()
    assert result.pdf_path.is_file()


def test_rerender_without_a_saved_extraction(settings, template):
    with pytest.raises(FileNotFoundError):
        pipeline.rerender("missing", settings)


def test_main_runs_the_whole_pipeline(
    settings, recording, template, stub_stages, monkeypatch, capsys
):
    monkeypatch.setattr(Settings, "load", classmethod(lambda cls: settings))

    assert main.main(["run", str(recording)]) == 0

    out = capsys.readouterr().out
    assert "2 need review" in out
    assert "Recording_20.csv" in out
    assert "Recording_20-measurements.csv" in out


def test_main_menu_picks_a_recording(
    settings, recording, template, stub_stages, monkeypatch, capsys
):
    monkeypatch.setattr(Settings, "load", classmethod(lambda cls: settings))
    answers = iter(["9", "junk", "1"])
    monkeypatch.setattr("builtins.input", lambda _: next(answers))

    assert main.main(["run"]) == 0
    assert capsys.readouterr().out.count("no such number") == 2


def test_main_menu_quits_on_a_blank_choice(settings, recording, template, stub_stages, monkeypatch):
    monkeypatch.setattr(Settings, "load", classmethod(lambda cls: settings))
    monkeypatch.setattr("builtins.input", lambda _: "")

    assert main.main(["run"]) == 0
    assert not settings.output_dir.exists()


def test_main_reports_an_empty_recordings_directory(settings, monkeypatch, capsys):
    monkeypatch.setattr(Settings, "load", classmethod(lambda cls: settings))

    assert main.main(["run"]) == 1
    assert "no recordings" in capsys.readouterr().err


def test_main_maps_a_missing_file_to_exit_2(settings, monkeypatch, capsys):
    monkeypatch.setattr(Settings, "load", classmethod(lambda cls: settings))

    assert main.main(["run", "nope.m4a"]) == 2
    assert "not found" in capsys.readouterr().err


def test_main_reports_a_missing_template_without_a_traceback(
    settings, recording, stub_stages, monkeypatch, capsys
):
    monkeypatch.setattr(Settings, "load", classmethod(lambda cls: settings))
    settings.form_template_path.unlink(missing_ok=True)

    assert main.main(["run", str(recording)]) == 1
    assert "report template not found" in capsys.readouterr().err


def test_main_surfaces_config_errors_without_a_traceback(monkeypatch, capsys):
    def unconfigured(cls):
        raise ConfigError("OPENAI_API_KEY is not set.")

    monkeypatch.setattr(Settings, "load", classmethod(unconfigured))

    assert main.main(["run"]) == 1
    assert "OPENAI_API_KEY" in capsys.readouterr().err


def test_main_extract_uses_an_existing_transcript(
    settings, recording, template, stub_stages, monkeypatch
):
    monkeypatch.setattr(Settings, "load", classmethod(lambda cls: settings))
    pipeline.transcribe_stage(recording, settings)

    assert main.main(["extract", "Recording_20"]) == 0
    assert stub_stages["transcribed"] == 1  # extract did not re-transcribe


def test_main_rerender_after_a_run(settings, recording, template, stub_stages, monkeypatch):
    monkeypatch.setattr(Settings, "load", classmethod(lambda cls: settings))
    main.main(["run", str(recording)])

    assert main.main(["rerender", "Recording_20"]) == 0
