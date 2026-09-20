/**
 * Crash-durable storage for a recording in progress.
 *
 * An inspection runs half an hour and, until this existed, lived entirely in a
 * JS array inside one tab. A crash, an OOM kill on a factory tablet with the
 * page backgrounded, or a stray close threw the whole session away — with the
 * garments already back on the line and nothing to re-record. MediaRecorder
 * hands us a chunk a second anyway, so each one is written here as it arrives
 * and the recording outlives the tab.
 *
 * IndexedDB rather than localStorage, which fails three separate ways for this:
 * it is synchronous and would stutter the level meter's animation loop, it
 * stores strings so a Blob would have to travel as base64, and its ~5MB cap is
 * a fraction of a half-hour recording.
 *
 * Raw IndexedDB rather than a wrapper. This is "put a blob in a store, read
 * them back in order"; idb or dexie would be more code than they save.
 *
 * Every call fails soft. Storage can be unavailable outright (private
 * browsing, blocked site data) or evicted under pressure, and none of that may
 * stop a recording: the capture is the product and this is insurance around it.
 */

const DB_NAME = "sizeset-recordings";
const DB_VERSION = 1;
const SESSIONS = "sessions";
const CHUNKS = "chunks";

/** One recording, from the moment it starts until the server has it. */
export interface StoredSession {
  id: string;
  /** Named at start, not at stop, so a recovered take keeps its own name. */
  filename: string;
  mimeType: string;
  startedAt: number;
  /** Recorded milliseconds. 0 until the recording is stopped properly. */
  ms: number;
  /** `recording` means the tab died mid-inspection; `ready` means it stopped. */
  status: "recording" | "ready";
  /** What the live monitor heard. Audit only — no stage of the pipeline reads it. */
  liveTranscript: string;
}

interface StoredChunk {
  session: string;
  seq: number;
  blob: Blob;
}

let opening: Promise<IDBDatabase | null> | null = null;

/** The database, or null wherever it cannot be had. Opened once. */
function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null); // blocked site data throws rather than failing
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSIONS)) {
        db.createObjectStore(SESSIONS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CHUNKS)) {
        // Compound key, so reading a range gives one session's chunks already
        // in sequence. The order is the whole correctness story — see
        // assembleChunks.
        db.createObjectStore(CHUNKS, { keyPath: ["session", "seq"] });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Run one transaction against one store.
 *
 * `work` must issue a single request: an IndexedDB transaction closes as soon
 * as the microtask queue drains with nothing outstanding, so awaiting between
 * two requests inside one transaction is how this quietly stops working.
 */
async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T>,
): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  try {
    return await work(db.transaction(name, mode).objectStore(name));
  } catch (cause) {
    console.warn(`recording store: ${mode} on ${name} failed`, cause);
    return null;
  }
}

/** Every chunk of one session, as a key range. */
const rangeFor = (session: string) =>
  IDBKeyRange.bound([session, 0], [session, Number.MAX_SAFE_INTEGER]);

/**
 * Ask the browser not to evict this origin's storage.
 *
 * Best-effort by design: it can be refused, and a refusal is not a reason to
 * stop recording. Without it a long inspection is evictable under disk
 * pressure, which is exactly when a tablet is also most likely to kill the tab.
 */
export async function keepStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* unsupported or refused; the recording is unaffected either way */
  }
}

export async function startSession(session: StoredSession): Promise<void> {
  await withStore(SESSIONS, "readwrite", (store) => settled(store.put(session)));
}

export async function appendChunk(session: string, seq: number, blob: Blob): Promise<void> {
  await withStore(CHUNKS, "readwrite", (store) => settled(store.put({ session, seq, blob })));
}

/**
 * Mark a recording stopped and merge in what is now known about it.
 *
 * Call this once per recording. It is a read then a write, so two of them in
 * flight together lose whichever field the second one did not carry — which is
 * why the duration and the monitor's text travel in the same call.
 *
 * A session that has already gone is left gone rather than resurrected.
 */
export async function finishSession(
  id: string,
  patch: Partial<Omit<StoredSession, "id">>,
): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const store = db.transaction(SESSIONS, "readonly").objectStore(SESSIONS);
    const existing = await settled<StoredSession | undefined>(store.get(id));
    if (!existing) return;
    // A second transaction: the read above already drained this one.
    await withStore(SESSIONS, "readwrite", (write) =>
      settled(write.put({ ...existing, status: "ready", ...patch })),
    );
  } catch (cause) {
    console.warn("recording store: could not finish session", cause);
  }
}

/**
 * Recordings still held here, newest first.
 *
 * A session is deleted the moment the server accepts it, so anything left is
 * either a recording whose tab died or a take that was never uploaded.
 */
export async function pendingSessions(): Promise<StoredSession[]> {
  const rows = await withStore(SESSIONS, "readonly", (store) =>
    settled<StoredSession[]>(store.getAll()),
  );
  return (rows ?? []).sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Rebuild one recording's chunks into a file.
 *
 * Pure, and separated from the storage read, because this is where a bug is
 * silent: MediaRecorder chunks are NOT independently valid. Only the first
 * carries the container header — the WebM EBML header, or the MP4 init
 * segment — and every later chunk is raw cluster data. Concatenated in order
 * they are a playable file; reordered they are corrupt, and without chunk 0
 * there is no header at all and nothing will open it.
 *
 * So a set missing its first chunk is refused rather than handed over as a
 * file that looks fine until someone tries to play it. An interior gap is not
 * refused — the audio either side of it is still worth having, and the intake
 * pane already asks the operator to play a take back before processing it.
 */
export function assembleChunks(
  chunks: { seq: number; blob: Blob }[],
  filename: string,
  mimeType: string,
): File | null {
  if (chunks.length === 0) return null;
  // Already ascending out of a key range; sorted again because the cost of
  // being wrong is the entire recording and the cost of being sure is one line.
  const ordered = [...chunks].sort((a, b) => a.seq - b.seq);
  if (ordered[0].seq !== 0) return null;
  return new File([new Blob(ordered.map((chunk) => chunk.blob), { type: mimeType })], filename, {
    type: mimeType,
  });
}

/** One stored recording as a file, ready for the ordinary upload path. */
export async function assembleFile(session: StoredSession): Promise<File | null> {
  const rows = await withStore(CHUNKS, "readonly", (store) =>
    settled<StoredChunk[]>(store.getAll(rangeFor(session.id))),
  );
  return rows ? assembleChunks(rows, session.filename, session.mimeType) : null;
}

/**
 * Forget a recording entirely.
 *
 * Called once the server has accepted it, and when an operator discards one.
 * Two transactions rather than one: they are not atomic, so a failure between
 * them leaves a session with no chunks, which `assembleFile` reports as
 * unrecoverable rather than as an empty recording.
 */
export async function dropSession(id: string): Promise<void> {
  await withStore(CHUNKS, "readwrite", (store) => settled(store.delete(rangeFor(id))));
  await withStore(SESSIONS, "readwrite", (store) => settled(store.delete(id)));
}
