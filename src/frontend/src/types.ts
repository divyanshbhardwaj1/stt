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
