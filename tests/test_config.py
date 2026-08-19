"""Configuration service: environment loading and fail-fast settings."""

import os

import pytest

from services.config import ConfigError, Settings, load_env_file


def test_settings_require_an_api_key():
    with pytest.raises(ConfigError, match="OPENAI_API_KEY"):
        Settings.load(env={})


def test_settings_default_the_models(tmp_path):
    loaded = Settings.load(env={"OPENAI_API_KEY": "sk-test", "SIZESET_DATA_DIR": str(tmp_path)})

    assert loaded.transcribe_model == "gpt-transcribe"
    assert loaded.extract_model == "gpt-5.6-sol"


def test_settings_allow_model_overrides(tmp_path):
    loaded = Settings.load(
        env={
            "OPENAI_API_KEY": "sk-test",
            "SIZESET_DATA_DIR": str(tmp_path),
            "SIZESET_EXTRACT_MODEL": "gpt-5.6-luna",
        }
    )

    assert loaded.extract_model == "gpt-5.6-luna"


def test_data_directories_hang_off_the_data_dir(settings, tmp_path):
    assert settings.recordings_dir == tmp_path / "recordings"
    assert settings.transcripts_dir == tmp_path / "transcripts"
    assert settings.references_dir == tmp_path / "references"
    assert settings.output_dir == tmp_path / "output"


def test_load_env_file_parses_comments_and_quotes(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text('# OPENAI_API_KEY=commented-out\nSIZESET_TEST_KEY="sk-quoted"\n')
    monkeypatch.delenv("SIZESET_TEST_KEY", raising=False)

    load_env_file(env_file)

    assert os.environ["SIZESET_TEST_KEY"] == "sk-quoted"
    assert "# OPENAI_API_KEY" not in os.environ


def test_load_env_file_does_not_override_the_real_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("SIZESET_TEST_KEY", "from-shell")
    (tmp_path / ".env").write_text("SIZESET_TEST_KEY=from-file\n")

    load_env_file(tmp_path / ".env")

    assert os.environ["SIZESET_TEST_KEY"] == "from-shell"


def test_load_env_file_tolerates_a_missing_file(tmp_path):
    load_env_file(tmp_path / "absent.env")  # must not raise
