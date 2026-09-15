import type { CellEdit, DownloadKind, GradedSheet, Job, PlaybackCues } from "./types";

/** Style numbers with a spec sheet on disk, for the intake dropdown. */
export async function fetchStyleSets(): Promise<string[]> {
  const response = await fetch("/api/style-sets");
  if (!response.ok) throw new Error(`/api/style-sets returned ${response.status}`);
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
): Promise<Job> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("recording", file);
    body.append("style_no", styleNo);
    body.append("live_transcript", liveTranscript);

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

/** Where each reading sits in the recording. Built on first ask, then cached. */
export async function fetchCues(jobId: string): Promise<PlaybackCues> {
  const response = await fetch(`/api/jobs/${jobId}/cues`);
  if (!response.ok) throw new Error(await detail(response, "Could not locate the readings."));
  return response.json();
}
