import type { DownloadKind, Job } from "./types";

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
