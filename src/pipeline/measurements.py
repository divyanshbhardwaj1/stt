"""Fractional-inch measurements: parse, format, tolerance-check.

Every value stays an exact Fraction. Floats are never used here — the whole job
turns on eighths of an inch, and 0.375 + 0.375 must not drift.

The extraction stage normalises spoken Hindi/English into canonical strings
("सवा तेईस" -> "23 1/4", "one by eight" -> "1/8"), so there is no Hindi number
table to maintain in this module.

Used by the validation stage, which compares each extracted value against the
graded spec sheet. That stage lands once the client's spec Excel is available.
"""

from __future__ import annotations

import re
from fractions import Fraction

# ponytail: "3 by 4" is the one ASR artifact frequent enough to fix here.
# Everything else stays the extraction prompt's job.
_BY = re.compile(r"(\d+)\s*by\s*(\d+)", re.IGNORECASE)

_NUMBER = re.compile(
    r"""([+-]?)\s*(?:
          (\d+)\s+(\d+)\s*/\s*(\d+)   # 22 1/8
        | (\d+)\s*/\s*(\d+)           # 5/8
        | (\d+)                       # 38
    )""",
    re.VERBOSE,
)


def parse(text: object) -> Fraction | None:
    """'22 1/8' -> Fraction(177, 8). Returns None when `text` is not a measurement."""
    match = _NUMBER.fullmatch(_BY.sub(r"\1/\2", str(text).strip().replace("−", "-")))
    if not match:
        return None
    sign, whole, numerator, denominator, bare_num, bare_den, integer = match.groups()
    if "0" in (denominator, bare_den):
        return None
    if integer:
        value = Fraction(int(integer))
    elif bare_num:
        value = Fraction(int(bare_num), int(bare_den))
    else:
        value = int(whole) + Fraction(int(numerator), int(denominator))
    return -value if sign == "-" else value


def format_measurement(value: Fraction | int, signed: bool = False) -> str:
    """Fraction(177, 8) -> '22 1/8'. signed=True keeps a leading + on deviations."""
    value = Fraction(value)
    sign = "-" if value < 0 else "+" if signed and value else ""
    whole, fraction = divmod(abs(value), 1)
    parts = ([str(whole)] if whole or not fraction else []) + ([str(fraction)] if fraction else [])
    return sign + " ".join(parts)


def check_tolerance(
    spec: Fraction,
    actual: Fraction,
    tolerance_minus: Fraction,
    tolerance_plus: Fraction,
) -> tuple[Fraction, bool]:
    """Deviation from spec, and whether it lands inside the spec sheet's tolerance band."""
    deviation = actual - spec
    low, high = min(tolerance_minus, tolerance_plus), max(tolerance_minus, tolerance_plus)
    return deviation, low <= deviation <= high
