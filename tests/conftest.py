import shutil
from pathlib import Path

import pytest

from services.config import PROJECT_ROOT, Settings
from services.csv_filler import InspectionSheet, load_template

from .form_fixture import write_form_template

# The client's blank form is confidential and gitignored, so CI never sees it.
# Tests run against a generated stand-in with the same structure; the handful
# that must exercise the genuine file are marked `real_template` and skip when
# it is absent.
REAL_TEMPLATE = PROJECT_ROOT / "data" / "references" / "size-set.xls"
REAL_STYLE_SETS = PROJECT_ROOT / "data" / "StyleSets"

# Marker name -> (the client data it needs, how to tell whether it is there).
CLIENT_DATA = {
    "real_template": REAL_TEMPLATE,
    "real_style_sets": REAL_STYLE_SETS,
}


def pytest_configure(config):
    for marker, path in CLIENT_DATA.items():
        config.addinivalue_line("markers", f"{marker}: needs client data at {path}")


def pytest_collection_modifyitems(config, items):
    absent = {marker: path for marker, path in CLIENT_DATA.items() if not path.exists()}
    for item in items:
        for marker, path in absent.items():
            if marker in item.keywords:
                item.add_marker(pytest.mark.skip(reason=f"client data not present at {path}"))


@pytest.fixture
def real_template_path(tmp_path):
    """A copy of the client's genuine form. Only for tests marked `real_template`."""
    destination = tmp_path / REAL_TEMPLATE.name
    shutil.copy(REAL_TEMPLATE, destination)
    return destination


SHEET_PAYLOAD = {
    "form": {
        "style_no": "7270",
        "division": "AEO",
        "date": "07/30/26",
        "description": "Short Sleeve Button Up Monica",
        "colour": "Snow Flake",
        "grain_line": "OK",
        "notches": "OK",
        "graded_nest": "OK",
        "corrections_implemented": "OK",
        "yy_mini_marker": "0.76, two-way",
        "planned_submission_date": "29/07/26",
        "actual_submission_date": "30/07/26",
        "pcd": "08/18/26",
        "cut_quantity": "06 pcs",
        "size_set_inspection_result": "Pass with comment",
        "shrinkage": "L = 2.4% - 2.8%  W = 0.8%",
        "lining_shrinkage": "",
        "shrinkage_note": "3 rows tested, under 3% threshold - Acceptable",
        "measurement_result": "PASS",
        "measurement_graded_nest": "OK",
        "corrections_to_be_done": "Added L +2.5%, W +1%",
        "bring_back_to_specs": "",
        "cutting_check": "OK",
        "seam_allowance": "OK",
        "checks_corrections_implemented": "OK",
        "overall": "Approved to proceed - production/cutting to begin",
    },
    "accessories": [
        {"item": "MAIN LABEL", "status": "ALT", "note": "Pending - needs to be printed"},
        {"item": "INTERLINING", "status": "ACT", "note": ""},
        {"item": "THREAD", "status": "ACT", "note": ""},
    ],
    "comments": [
        {"comment": "Front bodice shirring uneven", "vendor_action": "Follow notches"},
        {"comment": "Stain at placket", "vendor_action": "Follow white SOP"},
    ],
    "rows": [
        {
            "section": "measurement",
            "size": "M",
            "field": "Front length from HPS to CF hem",
            "value": "22 1/8",
            "deviation": "+1/8",
            "note": "",
            "confidence": 0.97,
        },
        {
            "section": "measurement",
            "size": "M",
            "field": "Across front seam to seam",
            "value": "11",
            "deviation": "-1/4",
            "note": "",
            "confidence": 0.91,
        },
        {
            "section": "measurement",
            "size": "L",
            "field": "Side seam tie length",
            "value": "23 1/4",
            "deviation": "+1",
            "note": "assistant first read 21 3/4, corrected to 23 1/4",
            "confidence": 0.55,
        },
        {
            "section": "shrinkage",
            "size": "",
            "field": "Shell shrinkage",
            "value": "2.4% length, 0.8% width",
            "deviation": "",
            "note": "",
            "confidence": 0.9,
        },
        {
            "section": "comment",
            "size": "",
            "field": "Stain at placket",
            "value": "",
            "deviation": "",
            "note": "follow white SOP",
            "confidence": 0.8,
        },
    ],
}


@pytest.fixture
def settings(tmp_path):
    """Settings pointing at a throwaway data directory holding a stand-in form."""
    base = Settings(
        openai_api_key="sk-test",
        transcribe_model="gpt-transcribe",
        extract_model="gpt-5.6-sol",
        data_dir=tmp_path,
    )
    write_form_template(base.form_template_path)
    return base


@pytest.fixture
def template(settings):
    return load_template(settings.form_template_path)


@pytest.fixture
def sheet():
    return InspectionSheet.from_payload(SHEET_PAYLOAD)


@pytest.fixture
def recording(settings) -> Path:
    """A stand-in audio file inside the settings' recordings directory."""
    settings.recordings_dir.mkdir(parents=True, exist_ok=True)
    path = settings.recordings_dir / "Recording_20.m4a"
    path.write_bytes(b"audio")
    return path
