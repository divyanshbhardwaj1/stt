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
}

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
