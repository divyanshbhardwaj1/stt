/* The four inspection stages, as teams.

   Triburg runs a garment through four checks, in order, and they are not the
   same job done four times:

     Size set  one garment per size, every point of measure against the graded
               spec sheet. Measurement work, and the only stage where a
               deviation dictated aloud becomes a number on a vendor document.
     PPM       the pre-production meeting. Approvals and open points before
               bulk is cut — fabric, trims, wash, packing. Almost no measuring.
     Interim   an audit of the line mid-production. Sampling and defects, with
               a handful of critical measurements, not the full sheet.
     Final     the final random inspection against an AQL plan. Cartons drawn
               to a sampling table, defects classified, accept or reject.

   So a team is a stage, and the features belong to the stage. A size-set
   reviewer has a graded sheet and a spec library; a final inspector has a
   sampling plan and an AQL table; neither needs the other's screens and
   showing them anyway is how a product becomes four products in a trench
   coat.

   Membership is per team and so is the role: the same person is often a
   reviewer on size set and an approver on final, and treating that as one
   global role is what forces a factory to keep two logins. */

const TEAMS = {
  sizeset: {
    name: "Size set",
    order: 1,
    fill: "lavender",
    tag: "SS",
    blurb: "One garment per size, every point of measure against the graded sheet.",
    detail:
      "The sheet is the source of truth and the recording supplies only the deviation, so every measurement on the report is rebuilt as spec + deviation.",
    home: "dashboard.html",
    nav: [
      ["dashboard.html", "", "dashboard", "Dashboard"],
      ["record.html", "record", "record", "Record inspection"],
      ["library.html", "", "library", "Style sets"],
      ["logs.html", "", "log", "Activity"],
    ],
    listhead: "Inspections",
    items: [
      { file: "7122(4).mp3", status: "done", note: "3 verdicts missing", flag: true, href: "index.html" },
      { file: "rec 2365(4).webm", status: "running", note: "Second reading", href: "processing.html" },
      { file: "2463(1)(3).m4a", status: "done", note: "71 rows extracted", href: "states.html" },
      { file: "Recording_9662(1).mp3", status: "failed", note: "Failed", href: "states.html" },
    ],
    log: [
      ["21 Sep", "14:02", "a.bhatt", "correction", "Settled 1.22A at M — deviation −1/8", "7122(4)"],
      ["21 Sep", "13:58", "a.bhatt", "correction", "Regraded the sheet from M to L — 92 measurements rebuilt", "7122(4)"],
      ["21 Sep", "13:41", "a.bhatt", "access", "Opened the graded sheet", "7122(4)"],
      ["21 Sep", "11:22", "p.grewal", "access", "Downloaded the graded sheet PDF", "2365(2)"],
      ["21 Sep", "10:15", "s.iqbal", "correction", "Settled 2 readings by hand", "7147(1)"],
      ["21 Sep", "09:31", "r.menon", "record", "Processing finished — 74 rows, 3 without a verdict", "7122(4)"],
      ["21 Sep", "09:12", "r.menon", "record", "Recorded an inspection — 14 min 22 s", "7122(4)"],
      ["20 Sep", "17:31", "admin", "access", "Changed S. Iqbal from inspector to QA reviewer", "—"],
      ["20 Sep", "16:04", "s.iqbal", "record", "Uploaded a recording — 9 min 06 s", "2463(1)(3)"],
      ["20 Sep", "15:47", "admin", "access", "Added style_4408.pdf to the library", "4408"],
      ["20 Sep", "11:19", "r.menon", "record", "Processing failed — no measurements found", "9662(1)"],
    ],
    open: 6,
  },
  ppm: {
    name: "PPM",
    order: 2,
    fill: "peach",
    tag: "PP",
    blurb: "Approvals and open points before bulk is cut.",
    detail:
      "Fabric, trims, embroidery, wash standard, care labels and packing, each with an owner and a date. Nothing here is measured — the question is whether the factory may start.",
    home: "ppm.html",
    nav: [
      ["ppm.html", "", "dashboard", "Meetings"],
      ["library.html", "", "library", "Style sets"],
      ["logs.html", "", "log", "Activity"],
    ],
    listhead: "Meetings",
    items: [
      { file: "7122 · PPM", status: "running", note: "4 points open", flag: true, href: "ppm.html" },
      { file: "2365 · PPM", status: "done", note: "Cleared for bulk", href: "ppm.html" },
      { file: "9685 · PPM", status: "queued", note: "Scheduled 23 Sep", href: "ppm.html" },
    ],
    log: [
      ["21 Sep", "15:10", "p.grewal", "approval", "Marked the wash standard overdue — cutting held", "7122"],
      ["21 Sep", "15:02", "a.bhatt", "decision", "Raised a point — size set carries 3 open verdicts", "7122"],
      ["21 Sep", "14:30", "p.grewal", "decision", "Opened the pre-production meeting — 7 attending", "7122"],
      ["20 Sep", "16:20", "a.bhatt", "approval", "Signed off packing — polybag and carton", "7122"],
      ["19 Sep", "12:05", "p.grewal", "release", "Cleared 2365 for bulk — all 12 approvals signed", "2365"],
      ["19 Sep", "11:58", "a.bhatt", "approval", "Signed off the care label wording", "2365"],
      ["18 Sep", "10:40", "a.bhatt", "approval", "Signed off lab dips — 3 colourways within ΔE 1.0", "7122"],
      ["17 Sep", "09:15", "admin", "access", "Scheduled the 9685 meeting for 23 Sep", "9685"],
    ],
    open: 3,
  },
  interim: {
    name: "Interim",
    order: 3,
    fill: "ochre",
    tag: "IN",
    blurb: "An audit of the line while bulk is running.",
    detail:
      "Pieces pulled off the line, defects logged by category, and a handful of critical measurements — not the full sheet. The output is a defect rate and a decision to carry on or stop the line.",
    home: "interim.html",
    nav: [
      ["interim.html", "", "dashboard", "Line audits"],
      ["library.html", "", "library", "Style sets"],
      ["logs.html", "", "log", "Activity"],
    ],
    listhead: "Line audits",
    items: [
      { file: "7122 · Line 4", status: "running", note: "Audit in progress", flag: true, href: "interim.html" },
      { file: "2463 · Line 2", status: "done", note: "2.1% defect rate", href: "interim.html" },
    ],
    log: [
      ["21 Sep", "13:20", "s.iqbal", "defect", "Third audit — 330 pieces, 14 defects, 4.2%", "7122 · Line 4"],
      ["21 Sep", "13:18", "s.iqbal", "defect", "Logged 11 measurement defects at stations 6–9", "7122 · Line 4"],
      ["21 Sep", "11:05", "s.iqbal", "defect", "Second audit — 300 pieces, 6 defects, 2.0%", "7122 · Line 4"],
      ["21 Sep", "09:30", "r.menon", "defect", "First audit — 240 pieces, 3 defects, 1.3%", "7122 · Line 4"],
      ["21 Sep", "08:50", "r.menon", "decision", "Line start check — settings and first-off approved", "7122 · Line 4"],
      ["19 Sep", "16:44", "s.iqbal", "decision", "Closed the audit — 2.1%, within threshold", "2463 · Line 2"],
      ["19 Sep", "14:10", "s.iqbal", "release", "Stopped Line 2 for 40 minutes — needle policy", "2463 · Line 2"],
    ],
    open: 2,
  },
  final: {
    name: "Final",
    order: 4,
    fill: "teal",
    tag: "FN",
    blurb: "Final random inspection against an AQL plan.",
    detail:
      "Cartons drawn to the sampling table, defects classified critical, major and minor, and read against the accept and reject limits for the lot. The answer is one word and it ships or it does not.",
    home: "final.html",
    nav: [
      ["final.html", "", "dashboard", "Inspections"],
      ["library.html", "", "library", "Style sets"],
      ["logs.html", "", "log", "Activity"],
    ],
    listhead: "Lots",
    items: [
      { file: "2365 · 4,800 pcs", status: "failed", note: "Rejected — 11 major", flag: true, href: "final.html" },
      { file: "7147 · 3,200 pcs", status: "done", note: "Accepted", href: "final.html" },
      { file: "2463 · 1,500 pcs", status: "running", note: "Drawing cartons", href: "final.html" },
      { file: "9662 · 6,000 pcs", status: "queued", note: "Booked 24 Sep", href: "final.html" },
    ],
    log: [
      ["21 Sep", "16:05", "p.grewal", "decision", "Rejected the lot — 11 major against a reject number of 11", "2365 · 4,800"],
      ["21 Sep", "15:40", "s.iqbal", "defect", "Logged 6 measurement defects — bottom opening under spec", "2365 · 4,800"],
      ["21 Sep", "14:20", "s.iqbal", "defect", "Measured 8 pieces on 6 points of measure", "2365 · 4,800"],
      ["21 Sep", "13:05", "s.iqbal", "record", "Drew 48 cartons of 240 — sample of 200", "2365 · 4,800"],
      ["20 Sep", "17:10", "p.grewal", "release", "Sent the inspection report to the buyer", "7147 · 3,200"],
      ["20 Sep", "16:52", "p.grewal", "decision", "Accepted the lot — 3 major against an accept number of 10", "7147 · 3,200"],
      ["20 Sep", "12:30", "s.iqbal", "record", "Drew 32 cartons of 160 — sample of 200", "7147 · 3,200"],
      ["19 Sep", "10:00", "admin", "access", "Booked the 9662 inspection for 24 Sep", "9662 · 6,000"],
    ],
    open: 4,
  },
};

const TEAM_IDS = Object.keys(TEAMS).sort((a, b) => TEAMS[a].order - TEAMS[b].order);

const TEAM_KEY = "team";

function currentTeam() {
  try {
    const saved = localStorage.getItem(TEAM_KEY);
    if (saved && TEAMS[saved]) return saved;
  } catch (err) {
    /* fall through */
  }
  return "sizeset";
}

function setTeam(id, next) {
  if (!TEAMS[id]) return;
  try {
    localStorage.setItem(TEAM_KEY, id);
  } catch (err) {
    /* this page only */
  }
  location.href = next || TEAMS[id].home;
}

/* The teams a member belongs to, in stage order. An administrator is on all
   of them — not by being listed four times, but because that is what the flag
   means. */
function myTeams(who) {
  const person = who || member(session().id);
  if (!person) return [];
  if (person.admin) return TEAM_IDS.slice();
  return TEAM_IDS.filter((id) => person.teams && person.teams[id]);
}
