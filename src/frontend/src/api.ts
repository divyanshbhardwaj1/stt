import type { CellEdit, DownloadKind, GradedSheet, Job, PlaybackCues } from "./types";

/** Style numbers with a spec sheet on disk, for the intake dropdown. */
export async function fetchStyleSets(): Promise<string[]> {
  const response = await fetch("/api/style-sets");
  if (!response.ok) throw new Error(`/api/style-sets returned ${response.status}`);
  return response.json();
}

/** One line of the audit trail. */
export interface Event {
  id: string;
  /** ISO 8601, from the server. */
  at: string;
  user_id: string | null;
  /** The name as it was when this happened, so a deleted account still reads. */
  actor: string;
  kind: string;
  stage: string;
  what: string;
  subject: string;
}

/**
 * The trail, newest first.
 *
 * `limit` is the server's own cap, passed through: the Activity screen wants
 * the lot, the dashboard wants five, and asking for five should not carry five
 * hundred rows across to be thrown away.
 */
export async function fetchActivity(limit?: number): Promise<Event[]> {
  const response = await fetch(limit ? `/api/activity?limit=${limit}` : "/api/activity");
  if (!response.ok) throw new Error(await detail(response, "Could not read the log."));
  return response.json();
}

/** One line of the style set library. */
export interface LibrarySheet {
  style_no: string;
  document: string;
  readable: boolean;
  description: string;
  company: string;
  season: string;
  division: string;
  status: string;
  base_size: string;
  sizes: string[];
  poms: number;
  tolerance_model: string;
  from_scan: boolean;
  /** Epoch seconds of the last inspection graded against it, or null. */
  last_used: number | null;
}

/** A sheet plus its whole graded specification. */
export interface LibrarySheetDetail extends LibrarySheet {
  rows: {
    pom: string;
    description: string;
    minus: string;
    plus: string;
    specs: Record<string, string>;
  }[];
}

/** The library, with what is inside each sheet. */
export async function fetchLibrary(): Promise<LibrarySheet[]> {
  const response = await fetch("/api/style-sets/sheets");
  if (!response.ok) throw new Error(await detail(response, "Could not read the library."));
  return response.json();
}

export async function fetchLibrarySheet(styleNo: string): Promise<LibrarySheetDetail> {
  const response = await fetch(`/api/style-sets/sheets/${encodeURIComponent(styleNo)}`);
  if (!response.ok) throw new Error(await detail(response, "Could not read that sheet."));
  return response.json();
}

export async function removeStyleSet(styleNo: string): Promise<void> {
  const response = await fetch(`/api/style-sets/sheets/${encodeURIComponent(styleNo)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await detail(response, "The sheet was not removed."));
}

export const sheetPdfUrl = (styleNo: string) =>
  `/api/style-sets/sheets/${encodeURIComponent(styleNo)}/pdf`;

/** What the server read out of an accepted sheet. */
export interface StyleSetAdded {
  style_no: string;
  description: string;
  season: string;
  sizes: string[];
  poms: number;
  document: string;
}

/**
 * Put a buyer's graded sheet in the library.
 *
 * Nothing is typed alongside it: the style number, the sizes and the
 * tolerances are read out of the PDF, and a sheet that will not parse is
 * refused rather than filed and discovered at grading time.
 */
export async function uploadStyleSet(file: File, replace = false): Promise<StyleSetAdded> {
  const form = new FormData();
  form.append("sheet", file);
  if (replace) form.append("replace", "true");
  const response = await fetch("/api/style-sets", { method: "POST", body: form });
  if (!response.ok) throw new Error(await detail(response, "The sheet was not accepted."));
  return response.json();
}

/**
 * One job, in full.
 *
 * The list endpoint cannot carry everything the report needs. The three detail
 * tables are derived from the saved extraction and are not stored, the field
 * labels come off the client's own template, and rebuilding either means
 * reading files - far too much for an endpoint the browser polls every two
 * seconds against every inspection. So the report asks for the one job it is
 * showing, and the list stays cheap.
 */
export async function fetchJob(jobId: string): Promise<Job> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
  if (!response.ok) throw new Error(await detail(response, "Could not read that inspection."));
  return response.json();
}

/** Every job, newest first. */
export async function fetchJobs(): Promise<Job[]> {
  const response = await fetch("/api/jobs");
  if (!response.ok) throw new Error(`/api/jobs returned ${response.status}`);
  return response.json();
}

export const downloadUrl = (jobId: string, kind: DownloadKind) =>
  `/api/jobs/${jobId}/download/${kind}`;

/**
 * The vendor-facing documents, mirroring VENDOR_DOWNLOADS in src/api/app.py.
 *
 * These are the PDFs stamped "Subject to Legal Action if Disclosed Without
 * Authorization from AEO"; the rest are working files for the QA team. The
 * two lists have to agree, and the server is the one that decides.
 */
export const VENDOR_DOWNLOADS: DownloadKind[] = ["report", "graded"];

export const DOWNLOAD_TITLES: Record<DownloadKind, string> = {
  report: "Report PDF",
  graded: "Graded sheet PDF",
  form: "Form CSV",
  measurements: "Measurements CSV",
  graded_data: "Graded sheet CSV",
  data: "JSON",
};

/**
 * Upload a recording and queue it.
 *
 * XHR rather than fetch: only XHR reports upload progress, and an inspection
 * recording runs to tens of megabytes on a phone connection.
 *
 * `liveTranscript` is what the browser's monitor heard, saved server-side
 * beside the batch transcripts for audit. The pipeline never reads it.
 */
export function uploadRecording(
  file: File,
  styleNo: string,
  liveTranscript: string,
  onProgress: (fraction: number) => void,
  location = "",
  stage = "sizeset",
): Promise<Job> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("recording", file);
    body.append("style_no", styleNo);
    body.append("live_transcript", liveTranscript);
    body.append("stage", stage);
    if (location) body.append("location", location);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/jobs");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status === 202) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("The server accepted the upload but its reply was unreadable."));
        }
        return;
      }
      let detail = `Upload failed (${xhr.status}).`;
      try {
        detail = JSON.parse(xhr.responseText).detail || detail;
      } catch {
        /* keep the status-code message */
      }
      reject(new Error(detail));
    };
    xhr.onerror = () =>
      reject(new Error("Network error. The recording was not uploaded and is still loaded here."));
    xhr.send(body);
  });
}

/** The whole graded sheet as a grid, for the audit view. */
export async function fetchSheet(jobId: string): Promise<GradedSheet> {
  const response = await fetch(`/api/jobs/${jobId}/sheet`);
  if (!response.ok) throw new Error(await detail(response, "Could not load the graded sheet."));
  return response.json();
}

/**
 * Apply an operator's corrections and rebuild every output from them.
 *
 * `misplaced` names any cell that did not align back onto the point of measure
 * it was entered against. It is returned rather than thrown because the rest of
 * the save did happen — and a reading filed against the wrong row has to be
 * shown, not smoothed over.
 */
export async function settleCells(
  jobId: string,
  edits: CellEdit[],
): Promise<{ job: Job; sheet: GradedSheet; misplaced: { sheet_index: number; size: string }[] }> {
  const response = await fetch(`/api/jobs/${jobId}/sheet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ edits }),
  });
  if (!response.ok) throw new Error(await detail(response, "The corrections were not saved."));
  return response.json();
}

/** The server's own explanation where there is one, rather than a status code. */
async function detail(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return typeof body.detail === "string" ? body.detail : fallback;
  } catch {
    return `${fallback} (${response.status})`;
  }
}

/** Re-file a size's readings against a different column of the spec sheet. */
export async function regradeSize(
  jobId: string,
  from: string,
  to: string,
): Promise<{ job: Job; sheet: GradedSheet }> {
  const response = await fetch(`/api/jobs/${jobId}/size`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  if (!response.ok) throw new Error(await detail(response, "The size was not changed."));
  return response.json();
}

export const audioUrl = (jobId: string) => `/api/jobs/${jobId}/audio`;

/** The transcript the report was extracted from — not the live monitor's. */
export const transcriptUrl = (jobId: string) => `/api/jobs/${jobId}/transcript`;

/** Where each reading sits in the recording. Built on first ask, then cached. */
export async function fetchCues(jobId: string): Promise<PlaybackCues> {
  const response = await fetch(`/api/jobs/${jobId}/cues`);
  if (!response.ok) throw new Error(await detail(response, "Could not locate the readings."));
  return response.json();
}

/* ------------------------------------------------------------------ roster */

/** One user, mirroring `_user()` in src/api/app.py. */
export interface User {
  /** A uuid: the stable identity. Never shown, always used to address them. */
  id: string;
  /** The credential, and what a person recognises on a roster. */
  email: string;
  name: string;
  admin: boolean;
  state: string;
  roles: Record<string, string>;
  stages: string[];
  created_at: string | null;
  last_seen_at: string | null;
}

export interface Roster {
  users: User[];
  stages: string[];
  roles: { id: string; label: string; can: string[] }[];
  capabilities: { id: string; label: string }[];
}

/**
 * The server's error wording, not ours.
 *
 * Every refusal in services/auth.py is phrased for the person reading it —
 * "give them a role on at least one stage", "this is the last administrator".
 * Replacing those with a generic failure here would throw away the only part
 * that tells somebody what to do next.
 */
async function ask<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || `${url} returned ${response.status}`);
  return body as T;
}

const asJson = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchRoster = () => ask<Roster>("/api/users");

export const addUser = (draft: {
  email: string;
  name: string;
  roles: Record<string, string>;
  admin: boolean;
  password: string;
}) => ask<User>("/api/users", { method: "POST", ...asJson(draft) });

export const patchUser = (
  id: string,
  patch: Partial<{
    email: string;
    name: string;
    roles: Record<string, string>;
    admin: boolean;
    state: string;
    password: string;
  }>,
) => ask<User>(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", ...asJson(patch) });

export const removeUser = (id: string) =>
  ask<{ detail: string }>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" });

export const changePassword = (current: string, password: string) =>
  ask<{ detail: string; sessions_ended: number }>("/api/me/password", {
    method: "POST",
    ...asJson({ current, password }),
  });
