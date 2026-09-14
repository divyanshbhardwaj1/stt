"""The shape of a filled inspection.

The client's form drives this file. `FORM_FIELDS` are the named boxes on the
Size Set Inspection Report; accessories and comments are its two grids; `rows`
carries the measurement detail, which on paper lives on the attached spec sheet.

The CSV, the PDF and the strict JSON schema the model must answer with all derive
from here, so the fields are defined in exactly one place.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

SECTIONS = ("measurement", "construction", "bom", "shrinkage", "marker", "comment")
ROW_COLUMNS = (
    "section",
    "size",
    "field",
    "value",
    "deviation",
    "verdict",
    "note",
    "confidence",
)

# What the inspector was heard to say about a point of measure. A blank
# `deviation` used to carry two very different meanings — "he said okay" and
# "we did not hear one" — and reporting the second as on-spec is how a real
# deviation reaches a vendor as a pass. The model now has to say which it was.
VERDICT_DEVIATION = "deviation"
VERDICT_OKAY = "okay"
VERDICT_NOT_STATED = "not stated"
VERDICTS = (VERDICT_DEVIATION, VERDICT_OKAY, VERDICT_NOT_STATED)

# The named boxes on the form, in the order they appear on it.
FORM_FIELDS = (
    "style_no",
    "division",
    "date",
    "description",
    "colour",
    "grain_line",
    "notches",
    "graded_nest",
    "corrections_implemented",
    "yy_mini_marker",
    "planned_submission_date",
    "actual_submission_date",
    "pcd",
    "cut_quantity",
    "size_set_inspection_result",
    "shrinkage",
    "lining_shrinkage",
    "shrinkage_note",
    "measurement_result",
    "measurement_graded_nest",
    "corrections_to_be_done",
    "bring_back_to_specs",
    "cutting_check",
    "seam_allowance",
    "checks_corrections_implemented",
    "overall",
)

# Tuned against Recording_20: the model reports 1.0 for cleanly stated values and
# drops to 0.55-0.80 for anything it reconstructed or heard through crosstalk.
REVIEW_THRESHOLD = 0.85


@dataclass(frozen=True)
class InspectionRow:
    """One measurement or observation stated during the inspection."""

    section: str
    size: str
    field: str
    value: str
    deviation: str
    note: str
    confidence: float
    # One of VERDICTS. Defaulted so extractions saved before this field existed
    # still load — they are treated as unconfirmed, because for those we
    # genuinely cannot tell an unspoken verdict from a lost one.
    verdict: str = ""
    # The exact point of measure this reading belongs to, as a position in the
    # sheet's spoken rows. -1 means "work it out", which is every row the model
    # extracts: the aligner matches dictation to the sheet by wording, because
    # nobody reads POM codes aloud. A human settling a cell in the audit view is
    # the one case where the row is known rather than inferred, and inferring it
    # there would be worse than useless - a reading entered against one point of
    # measure and filed under another is a silent corruption of the sheet.
    pom_index: int = -1

    @property
    def confirmed_okay(self) -> bool:
        """The inspector was heard to pass this point of measure."""
        return self.verdict == VERDICT_OKAY

    @property
    def verdict_missing(self) -> bool:
        """No verdict was captured, so nothing may be concluded from silence."""
        return self.verdict in ("", VERDICT_NOT_STATED) and not self.deviation.strip()

    @property
    def needs_review(self) -> bool:
        """Whether a human must confirm this value before the report is sent.

        Confidence alone. `note` is not a signal — the model annotates most rows
        with useful context ("spoken as 1.38"), so flagging on it flagged 76% of
        the sheet and buried the handful that genuinely needed a second look.
        """
        return self.confidence < REVIEW_THRESHOLD


@dataclass(frozen=True)
class AccessoryCheck:
    """One row of the form's accessories grid."""

    item: str
    status: str  # MIS, ALT, ACT, PLA, or "" when the recording did not cover it
    note: str = ""  # qualifier printed as a footnote, e.g. "needs shanking added"


@dataclass(frozen=True)
class CommentAction:
    """One line of the form's Detailed Comments / Action To Be Taken grid."""

    comment: str
    vendor_action: str


@dataclass(frozen=True)
class Correction:
    """One change a human made to a row after the recording was processed.

    Kept apart from the row itself on purpose. `ROW_COLUMNS` is the schema the
    extraction model must answer with, and an audit trail is not something the
    model has any business emitting. Keeping corrections in their own list also
    keeps the whole history rather than only the most recent original.

    The report renders the corrected value plainly - the vendor is sent a
    finished sheet, not a marked-up one - so this list is the only record that
    a human, rather than the recording, settled the row.
    """

    # Position of the point of measure on the spec sheet. This, with `size`, is
    # what identifies the cell: report numbers shift whenever a row is inserted
    # ahead of them, so they are a historical note here, never a key.
    sheet_index: int
    size: str
    at: str  # ISO-8601, UTC
    pom: str  # the point of measure settled, for reading the trail on its own
    row: int  # report number as it stood when the change was made
    was_value: str
    was_deviation: str
    was_verdict: str
    now_value: str
    now_deviation: str
    now_verdict: str
    # The recording never covered this point of measure at all: the row did not
    # exist until an operator listened back and entered it.
    created: bool = False
    note: str = ""


@dataclass(frozen=True)
class InspectionSheet:
    """Everything pulled out of one recording, shaped like the client's form."""

    form: dict[str, str] = field(default_factory=dict)
    accessories: tuple[AccessoryCheck, ...] = ()
    comments: tuple[CommentAction, ...] = ()
    rows: tuple[InspectionRow, ...] = ()
    corrections: tuple[Correction, ...] = ()

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> InspectionSheet:
        form = payload.get("form", {})
        return cls(
            form={name: str(form.get(name, "")) for name in FORM_FIELDS},
            accessories=tuple(AccessoryCheck(**a) for a in payload.get("accessories", [])),
            comments=tuple(CommentAction(**c) for c in payload.get("comments", [])),
            rows=tuple(InspectionRow(**row) for row in payload.get("rows", [])),
            # Absent from every extraction saved before the audit view existed.
            corrections=tuple(Correction(**c) for c in payload.get("corrections", [])),
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "form": dict(self.form),
            "accessories": [asdict(a) for a in self.accessories],
            "comments": [asdict(c) for c in self.comments],
            "rows": [asdict(row) for row in self.rows],
            "corrections": [asdict(c) for c in self.corrections],
        }

    def field(self, name: str) -> str:
        return self.form.get(name, "")

    def check_for(self, item: str) -> AccessoryCheck | None:
        """The recorded check for an accessory, or None if it was never discussed."""
        wanted = item.strip().casefold()
        for accessory in self.accessories:
            if accessory.item.strip().casefold() == wanted:
                return accessory
        return None

    def status_for(self, item: str) -> str:
        """The MIS/ALT/ACT/PLA status recorded for an accessory, or ""."""
        found = self.check_for(item)
        return found.status if found else ""

    def accessory_notes(self) -> list[AccessoryCheck]:
        """Accessories carrying a qualifier, printed as footnotes under the grid."""
        return [accessory for accessory in self.accessories if accessory.note]

    def sizes(self) -> list[str]:
        """Sizes that actually carry measurements, in the order they were dictated."""
        seen: list[str] = []
        for row in self.rows:
            if row.section == "measurement" and row.size and row.size not in seen:
                seen.append(row.size)
        return seen

    def numbered(self) -> list[tuple[int, InspectionRow]]:
        """Every row with its report number.

        Numbering runs once across the whole extraction rather than restarting per
        section, so a number identifies the same row in the CSV, in the PDF and in
        a reviewer's comment.
        """
        return list(enumerate(self.rows, 1))

    def rows_in(self, section: str, size: str | None = None) -> list[tuple[int, InspectionRow]]:
        """Numbered rows of one section, optionally narrowed to one size."""
        return [
            (number, row)
            for number, row in self.numbered()
            if row.section == section and (size is None or row.size == size)
        ]

    def correction_for(self, sheet_index: int, size: str) -> Correction | None:
        """The most recent change a human made to one cell, if any."""
        found = [c for c in self.corrections if c.sheet_index == sheet_index and c.size == size]
        return found[-1] if found else None

    def flagged(self) -> list[tuple[int, InspectionRow]]:
        """Numbered rows a human must confirm before this report leaves the building."""
        return [(number, row) for number, row in self.numbered() if row.needs_review]

    def headline(self) -> str:
        """Style, description, colour and result, as one line."""
        parts = (
            f"Style {self.field('style_no')}" if self.field("style_no") else "",
            self.field("description"),
            f"Colour {self.field('colour')}" if self.field("colour") else "",
            self.field("size_set_inspection_result"),
        )
        return " · ".join(part for part in parts if part)
