/** The job payload, mirroring `Job.as_dict()` in src/api/jobs.py. */

export type JobStatus = "queued" | "running" | "done" | "failed";

/** Keys of `DOWNLOADS` in src/api/jobs.py. */
export type DownloadKind =
  | "report"
  | "graded"
  | "form"
  | "measurements"
  | "graded_data"
  | "data";

/** A low-confidence extracted row, from `Job.flagged_rows`. */
export interface FlaggedRow {
  no: number;
  size: string;
  field: string;
  value: string;
  deviation: string;
  confidence: number;
  note: string;
}

/** A point of measure the recording never ruled on, from `Job.unconfirmed_rows`. */
export interface UnconfirmedRow {
  no: number;
  size: string;
  pom: string;
  description: string;
  spec: string;
  spoken: string;
}

/** A measurement outside its tolerance band, from `Job.failed_rows`. */
export interface FailedRow {
  no: number;
  size: string;
  pom: string;
  description: string;
  spec: string;
  measured: string;
  deviation: string;
}

export interface Job {
  id: string;
  filename: string;
  style_no: string;
  /** Which of the four checks this inspection is. Mirrors `Stage` in enums.py. */
  stage: string;
  status: JobStatus;
  message: string;
  name: string;
  rows: number;
  flagged: number;
  sizes: string[];
  error: string;
  downloads: DownloadKind[];
  /** The 26 named boxes on the report; "" for anything the recording did not state. */
  form: Record<string, string>;
  accessories: number;
  comments: number;
  flagged_rows: FlaggedRow[];
  /** False when no style set matched, in which case nothing was checked against spec. */
  graded: boolean;
  graded_style_no: string;
  announced_style_no: string;
  measurement_result: string;
  judged: number;
  out_of_tolerance: number;
  unconfirmed: number;
  unconfirmed_rows: UnconfirmedRow[];
  failed_rows: FailedRow[];
  elapsed: number;
  /** Unix seconds. When the job started, for grouping by day. */
  started_at: number;
  /** Field name to the client's own printed label. Only on the single-job read. */
  form_labels?: Record<string, string>;
  /** Who recorded it. Resolved from the account, never stored as a name. */
  /** What a person called it. Empty for anything recorded before naming. */
  title: string;
  /**
   * The reviewer's verdict on the sheet: "", "pass", "comment" or "fail".
   * Not `measurement_result`, which is arithmetic — this is the call a person
   * made about the garment, and the two can honestly disagree.
   */
  review: string;
  review_note: string;
  reviewed_at: number | null;
  reviewed_by: string;
  /** Epoch seconds when an approver signed it off, or null. */
  released_at: number | null;
  /** Who signed it. Kept for display; the trail is the record. */
  released_by: string;
  recorded_by: string;
  /** The account that recorded it. "" for anything predating attribution. */
  recorded_by_id: string;
  /** Which bench or floor, typed by the operator at upload. */
  location: string;
  /** Whether a transcript was saved. Only on the single-job read. */
  transcript?: boolean;
}

/**
 * The style an inspection belongs to.
 *
 * What it was graded against, else what the recording announced, else the one
 * picked at upload — and "" when none of the three is known, which is its own
 * bucket on the register rather than a reason to drop the inspection.
 *
 * Here rather than beside the screen that reads it: three screens now group by
 * style, and three answers to "which style is this" is how two of them quietly
 * disagree.
 */
export const styleOf = (job: Job): string =>
  job.graded_style_no || job.announced_style_no || job.style_no || "";

/* ---------- the audit view ----------
   The graded sheet as a grid: every point of measure the client's sheet
   prints, one cell per size. The same shape the graded PDF renders, so screen
   and paper cannot drift apart. */

export type CellState = "empty" | "unconfirmed" | "fail" | "unjudged" | "pass";

export interface SheetCell {
  /** Report number of the reading behind this cell; null when nothing was heard. */
  row: number | null;
  /** What the spec sheet requires here. Present even for an empty cell. */
  spec: string;
  state: CellState;
  measured?: string;
  /** The signed deviation, or "ok" when the inspector passed it aloud. */
  deviation?: string;
  heard?: string;
  spoken?: string;
  note?: string;
  confidence?: number;
  /** A human settled this cell after the recording was processed. */
  edited?: boolean;
  /**
   * The recording contradicted itself: the absolute the inspector read aloud
   * matches neither the spec nor the measurement built from it. Not a verdict —
   * the report still uses spec + deviation — but worth listening back to.
   */
  disputed?: boolean;
  /** Anything short of certain — worth an eye. */
  below_full?: boolean;
  /** Under the report's own review threshold — the stronger claim. */
  low_confidence?: boolean;
  /**
   * What the inspector was heard to SAY, straight off the extraction.
   *
   * Not the same as `measured`/`deviation` above, which the sheet works out —
   * the measurement is rebuilt as spec + deviation. The editor must prefill
   * from this, or saving writes a computed number back over the spoken one.
   */
  stated?: { value: string; deviation: string; verdict: string; note: string };
}

export interface SheetRow {
  kind: "pom" | "note";
  pom: string;
  description: string;
  /** Absent on free-text rows off the client's sheet, which carry no readings. */
  sheet_index?: number;
  tol_minus?: string;
  tol_plus?: string;
  measured_here?: boolean;
  cells?: Record<string, SheetCell>;
}

export interface CorrectionEntry {
  sheet_index: number;
  row: number;
  at: string;
  pom: string;
  size: string;
  was: { value: string; deviation: string; verdict: string };
  now: { value: string; deviation: string; verdict: string };
  created: boolean;
}

export interface GradedSheet {
  style_no: string;
  sizes: string[];
  base_size: string;
  measured_sizes: string[];
  verdict: string;
  disputed: number;
  low_confidence: number;
  below_full: number;
  review_threshold: number;
  /** Which size column the recording's own numbers actually fit. */
  size_check: {
    assigned: string;
    best: string;
    disagrees: boolean;
    votes: Record<string, number>;
  }[];
  rows: SheetRow[];
  unmatched: { row: number; size: string; spoken: string; measured: string; deviation: string }[];
  corrections: CorrectionEntry[];
}

/**
 * One cell an operator settled. Only the fields they actually changed are sent:
 * sending the whole form back would overwrite the untouched ones with whatever
 * happened to be prefilled.
 */
export interface CellEdit {
  sheet_index: number;
  size: string;
  /**
   * An absolute the operator typed while listening back. The server converts it
   * to a deviation against the spec — in Fractions, because the report is built
   * on eighths of an inch and this must never go near a float.
   */
  measured?: string;
  deviation?: string;
  verdict?: string;
  note?: string;
}

/** Where each reading sits in the recording, keyed by report number. */
export interface PlaybackCues {
  duration: number;
  cues: Record<string, { start: number; end: number; exact: boolean }>;
}


/**
 * How an inspection is doing, as a word and a pill.
 *
 * Here rather than on a screen because two screens now show it — the register
 * expanded under a style, and the style's own four-stage view — and a register
 * that disagreed with the page it links to about what "Needs review" means
 * would be worse than either alone.
 */
export function stateOf(job: Job): [string, string] {
  if (job.status === "failed") return ["Failed", "pill error"];
  if (job.status !== "done") return ["Processing", "pill warning"];
  if (!job.graded) return ["Not graded", "pill"];
  // The end of the chain first: where an inspection got to beats how it got
  // there. Somebody scanning a register wants to know what is left to do.
  if (job.released_at) return ["Released", "pill success"];
  if (job.review === "fail") return ["Failed", "pill error"];
  // An open question outranks a failed measurement: a reading the recording
  // never ruled on is the one thing nobody can sign off around.
  if (job.unconfirmed > 0) return ["Needs review", "pill lavender"];
  if (job.review === "pass") return ["Waiting for sign-off", "pill success"];
  if (job.review === "comment") return ["Waiting for sign-off", "pill warning"];
  // Everything answered and nobody has ruled on the sheet as a whole. That is
  // a reviewer's job, not an approver's, so it is not "waiting for sign-off".
  return ["Needs review", "pill lavender"];
}

/** What came of it, in one line. */
export function summarise(job: Job): string {
  if (job.status === "failed") return job.error || "Nothing was written";
  if (job.status !== "done") return job.message;
  // Once a person has ruled, their words are the answer. The measurement
  // result is arithmetic and is still on the report; this line is what a
  // register is for.
  if (job.review) {
    const said =
      job.review === "pass"
        ? "Passed"
        : job.review === "comment"
          ? "Passed with comment"
          : "Failed";
    const who = job.reviewed_by ? ` by ${job.reviewed_by}` : "";
    return job.review_note ? `${said}${who} — ${job.review_note}` : `${said}${who}`;
  }
  if (!job.graded) return `${job.rows} rows · never checked against a spec sheet`;
  if (job.unconfirmed)
    return `${job.rows} rows · ${job.unconfirmed} point${
      job.unconfirmed === 1 ? "" : "s"
    } of measure with no verdict`;
  if (job.out_of_tolerance)
    return `${job.rows} rows · ${job.out_of_tolerance} out of tolerance`;
  return `${job.rows} rows · every verdict captured`;
}


/**
 * What to call an inspection on screen.
 *
 * The operator's name for it if they gave one, otherwise the recording it came
 * from. Here rather than on each screen because six of them show it, and six
 * fallbacks are six chances to show a different thing for the same inspection.
 */
export const label = (job: Job): string => job.title || job.filename || job.id;

/**
 * The name an inspection gets if nobody types one: style, date, time.
 *
 * Sortable on purpose — a list of `2463 - 2026-09-25 - 14:32` reads in order
 * on any screen that happens to sort by name, which a locale-formatted date
 * does not. The style comes first because it is the thing somebody searches
 * for, and is simply left out when the recording has not announced one yet.
 */
export function defaultTitle(styleNo: string, when: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  const time = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  return [styleNo.trim(), date, time].filter(Boolean).join(" - ");
}
