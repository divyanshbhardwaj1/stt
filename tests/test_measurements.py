"""Cases taken from Recording_20 and the style 7270 graded spec sheet."""

from fractions import Fraction as F

import pytest

from pipeline.measurements import check_tolerance, format_measurement, parse


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("38", F(38)),  # "thirty-eight"
        ("5/8", F(5, 8)),
        ("22 1/8", F(177, 8)),
        ("12 3 by 4", F(51, 4)),  # ASR artifact for "12 3/4"
        ("1 by 8", F(1, 8)),  # "one by eight"
        ("-1/8", F(-1, 8)),
        ("+ 1/4", F(1, 4)),
        ("17 1/2", F(35, 2)),  # "seventeen and a half"
        ("23 1/4", F(93, 4)),  # "सवा तेईस"
        ("  9 5 / 8 ", F(77, 8)),
    ],
)
def test_parse(text, expected):
    assert parse(text) == expected


@pytest.mark.parametrize("text", ["", "okay", "next", "12 3", "3/0", None, "1/2/3"])
def test_parse_rejects_non_measurements(text):
    assert parse(text) is None


@pytest.mark.parametrize(
    ("value", "signed", "expected"),
    [
        (F(177, 8), False, "22 1/8"),
        (F(38), False, "38"),
        (F(5, 8), False, "5/8"),
        (F(0), False, "0"),
        (F(-1, 8), True, "-1/8"),
        (F(1, 4), True, "+1/4"),
        (F(0), True, "0"),
    ],
)
def test_format_measurement(value, signed, expected):
    assert format_measurement(value, signed=signed) == expected


def test_format_round_trips_through_parse():
    for text in ("22 1/8", "38", "5/8", "-1/8"):
        assert format_measurement(parse(text), signed=text.startswith("-")) == text


def test_within_tolerance():
    """POM 1.01A front length, size M: spec 22, tol -3/8..+3/8, called out '+1/8'."""
    deviation, ok = check_tolerance(parse("22"), parse("22 1/8"), parse("-3/8"), parse("3/8"))

    assert format_measurement(deviation, signed=True) == "+1/8"
    assert ok


def test_on_the_tolerance_boundary_passes():
    """POM 1.23A across front, size M: spec 11 1/4, tol -1/4..+1/4, called out '-1/4'."""
    deviation, ok = check_tolerance(parse("11 1/4"), parse("11"), parse("-1/4"), parse("1/4"))

    assert format_measurement(deviation, signed=True) == "-1/4"
    assert ok


def test_outside_tolerance_fails():
    _, ok = check_tolerance(parse("11 1/4"), parse("10 7/8"), parse("-1/4"), parse("1/4"))

    assert not ok


def test_no_float_drift_across_eighths():
    """Three eighths summed must land exactly on 3/8, which floats do not guarantee."""
    assert sum([parse("1/8")] * 3) == parse("3/8")
