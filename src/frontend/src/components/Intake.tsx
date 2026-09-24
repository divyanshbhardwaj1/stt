import { useCallback, useEffect, useRef, useState } from "react";
import { fetchStyleSets, uploadRecording } from "../api";
import type { Job } from "../types";
import { hms, megabytes } from "../format";
import {
  transcriptText,
  useLiveTranscript,
  type Utterance,
} from "../hooks/useLiveTranscript";
import { useRecorder, type Take } from "../hooks/useRecorder";
import {
  assembleFile,
  dropSession,
  finishSession,
  pendingSessions,
  type StoredSession,
} from "../recordingStore";
import { LiveTranscript } from "./LiveTranscript";
import { Waveform } from "./Waveform";

interface Props {
  /**
   * The job the server just accepted. The whole job, not its id: the parent
   * renders it straight away, so pressing Process does not leave the previous
   * inspection on screen until the next poll lands.
   */
  onQueued: (job: Job) => void;
  /**
   * What fills the work pane when no transcript is showing - the selected
   * report, or the empty state. Passed in rather than rendered by the parent
   * so the transcript can take the pane over while a recording is in progress,
   * which is where there is room for it to run top to bottom.
   */
}

/**
 * The recorder, top of the work pane.
 *
 * Sticky, because it is the primary action and because a running waveform
 * should stay visible while a reviewer scrolls the report underneath it.
 */
/**
 * A street address for a fix, from OpenStreetMap's public reverse geocoder.
 *
 * The browser knows where it is and nothing else; turning that into something
 * a person can read is somebody else's dataset. Nominatim is the one that
 * needs no key and no account, at the price of telling openstreetmap.org
 * roughly where the inspection is happening.
 *
 * Composed from the address parts rather than Nominatim's `display_name`,
 * which leads with a house number and a building name and runs past the 128
 * characters the column holds. Returns "" on anything going wrong — the
 * caller keeps the coordinates, which are worse to read and just as true.
 */
async function placeName(latitude: number, longitude: number): Promise<string> {
  const url =
    "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&" +
    new URLSearchParams({ lat: String(latitude), lon: String(longitude) });
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return "";
    const found = (await response.json()) as { address?: Record<string, string> };
    const at = found.address ?? {};
    const parts = [
      at.road || at.neighbourhood || at.industrial,
      at.suburb || at.city_district,
      at.city || at.town || at.village || at.county,
      at.state,
      at.postcode,
    ];
    // Nominatim repeats itself freely - a suburb and a city district are often
    // the same word - and a location that says "Gurugram, Gurugram" reads as a
    // bug rather than a place.
    const seen = new Set<string>();
    return parts
      .filter((part): part is string => Boolean(part) && !seen.has(part!) && !!seen.add(part!))
      .join(", ")
      .slice(0, 128);
  } catch {
    return "";
  }
}

export function Intake({ onQueued }: Props) {
  const [take, setTake] = useState<Take | null>(null);
  /**
   * What the monitor heard for the take in hand.
   *
   * Snapshotted because the live session ends with the stream: without this the
   * transcript would vanish at the moment the operator is deciding whether the
   * recording is worth processing.
   */
  const [heard, setHeard] = useState<Utterance[]>([]);
  const [picked, setPicked] = useState<File | null>(null);
  /**
   * Where the take in hand is stored, so it can be forgotten once uploaded.
   *
   * Empty for a file the operator chose off disk: that one already exists
   * somewhere they control, so there is nothing of ours to clean up.
   */
  const [takeSession, setTakeSession] = useState("");
  /**
   * Recordings held in browser storage that the server has never accepted -
   * a tab that died mid-inspection, or a take whose upload never landed.
   */
  const [stored, setStored] = useState<StoredSession[]>([]);
  /** The monitor's text off a recovered recording, which has no live session. */
  const [savedTranscript, setSavedTranscript] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [styleNo, setStyleNo] = useState("");
  /**
   * Where the inspection happened. The browser is asked first - an operator
   * who has to type the bench every take types it once and then stops. Typing
   * is the fallback for a denied prompt, a desk with no fix, or http.
   */
  const [location, setLocation] = useState(() => {
    try {
      return window.localStorage.getItem("location") || "";
    } catch {
      return "";
    }
  });
  const [locating, setLocating] = useState(() => "geolocation" in navigator);
  /** True once the browser answered, which is what makes the field secondary. */
  const [located, setLocated] = useState(false);
  /** The raw fix. Kept for the hint, and used as the location until the
      address resolves - or for good, if it never does. */
  const [coords, setCoords] = useState("");
  /** Metres, for the hint. Never part of the stored location. */
  const [accuracy, setAccuracy] = useState(0);
  const [styleSets, setStyleSets] = useState<string[] | null>(null);
  const [styleError, setStyleError] = useState("");
  const [progress, setProgress] = useState(-1); // -1 = not uploading
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // ponytail: coordinates, not a place name - a name needs a reverse-geocoding
  // service, and sending a client's inspection floor to a third party to be
  // told "Gurugram" is not a trade worth making.
  useEffect(() => {
    if (!navigator.geolocation) return;
    let live = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!live) return;
        const { latitude, longitude, accuracy: metres } = position.coords;
        setCoords(latitude.toFixed(5) + ", " + longitude.toFixed(5));
        setAccuracy(metres);
        setLocated(true);
        setLocating(false);
        // The address is a second, slower answer. The fix is shown the moment
        // it lands so the screen is never waiting on a service we do not run.
        void placeName(latitude, longitude).then((place) => {
          if (live && place) setLocation(place);
        });
      },
      // Denied, unavailable, or timed out: all the same answer to us, which is
      // that the operator gets the box to type in.
      () => live && setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 300_000 },
    );
    return () => {
      live = false;
    };
  }, []);

  const liveHeard = useRef<Utterance[]>([]);

  const accept = useCallback((next: Take) => {
    setPicked(null);
    setTake(next);
    setTakeSession(next.sessionId);
    setHeard(liveHeard.current);
    setSavedTranscript("");
    setPreviewUrl(URL.createObjectURL(next.file));
    // One write, marking the recording stopped and saving everything known
    // about it. The transcript is written here rather than as it streams
    // because nothing downstream reads it - it is audit material, not worth a
    // write per utterance.
    void finishSession(next.sessionId, {
      ms: next.ms,
      liveTranscript: transcriptText(liveHeard.current),
    });
  }, []);

  const recorder = useRecorder(accept);
  const live = recorder.state !== "idle";
  const pending = take?.file ?? picked;

  // Taps the recorder's own MediaStream: no second microphone prompt, and no
  // interference with MediaRecorder, which keeps writing the real recording.
  const transcript = useLiveTranscript(
    recorder.liveStream,
    recorder.state === "paused",
    recorder.elapsed,
    recorder.pauses,
  );
  // `lines`, not `utterances`: when the operator presses Done the last thing
  // said is still an open line, and saving only the closed ones would drop it.
  useEffect(() => {
    liveHeard.current = transcript.lines;
  }, [transcript.lines]);

  useEffect(() => {
    fetchStyleSets()
      .then(setStyleSets)
      .catch((cause: unknown) => {
        // An empty dropdown with no explanation reads as "no styles exist" when
        // it usually means a stale tab pointed at an older server.
        console.error("could not load style sets:", cause);
        setStyleSets([]);
        setStyleError("Could not load style sets - reload");
      });
  }, []);

  // Revoke the last preview URL rather than leaking one blob per take.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // An inspection runs half an hour and lives only in this tab until it is
  // uploaded. Closing mid-recording, or with a finished take still unsent,
  // would throw all of it away silently.
  useEffect(() => {
    if (!live && !take) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [live, take]);

  const refreshStored = useCallback(() => {
    void pendingSessions().then(setStored);
  }, []);

  useEffect(() => {
    refreshStored();
  }, [refreshStored]);

  /** Load a stored recording back into the intake, as though it had just stopped. */
  const recover = useCallback(async (session: StoredSession) => {
    setRecovering(true);
    setUploadError("");
    try {
      const file = await assembleFile(session);
      if (!file) {
        setUploadError(
          `${session.filename} could not be rebuilt: its opening chunk is missing, and ` +
            "without that there is no container header and nothing can play it. " +
            "Nothing else was touched.",
        );
        return;
      }
      setPicked(null);
      setTake({ file, ms: session.ms, sessionId: session.id });
      setTakeSession(session.id);
      setHeard([]);
      setSavedTranscript(session.liveTranscript);
      setPreviewUrl(URL.createObjectURL(file));
    } finally {
      setRecovering(false);
    }
  }, []);

  const forget = useCallback(
    async (id: string) => {
      await dropSession(id);
      refreshStored();
    },
    [refreshStored],
  );

  const clear = useCallback(() => {
    // The take is finished with - uploaded, or thrown away on purpose - so the
    // stored copy goes too. This is the ONLY place it is dropped: anywhere
    // earlier and a failed upload would take the inspection with it.
    if (takeSession) void dropSession(takeSession).then(refreshStored);
    setTake(null);
    setTakeSession("");
    setHeard([]);
    setSavedTranscript("");
    setPicked(null);
    setPreviewUrl("");
    setUploadError("");
    recorder.setError("");
    if (fileInput.current) fileInput.current.value = "";
  }, [recorder, takeSession, refreshStored]);

  const choose = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      setTake(null);
      setHeard([]);
      setPreviewUrl("");
      setUploadError("");
      setPicked(file);
    },
    [],
  );

  const process = useCallback(async () => {
    if (!pending) return;
    setUploadError("");
    setProgress(0);
    try {
      // A recovered take has no live session behind it, so its monitor text
      // comes back off the stored recording instead.
      const monitor = heard.length ? transcriptText(heard) : savedTranscript;
      try {
        // A typed bench is the same tomorrow; yesterday's coordinates are not.
        if (!located) window.localStorage.setItem("location", location);
      } catch {
        /* the upload still carries it */
      }
      const job = await uploadRecording(
        pending,
        styleNo,
        monitor,
        setProgress,
        location || coords,
      );
      setProgress(-1);
      clear();
      onQueued(job);
    } catch (cause) {
      setProgress(-1);
      setUploadError(cause instanceof Error ? cause.message : "Upload failed.");
    }
  }, [pending, styleNo, location, coords, located, heard, savedTranscript, clear, onQueued]);

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (live) return; // never swap the take mid-recording
    choose(event.dataTransfer?.files?.[0]);
  };

  const error = uploadError || recorder.error || styleError;

  return (
    <div
      className="recscreen"
      onDragEnter={(e) => {
        e.preventDefault();
        if (!live) setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!live) setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header>
        <div className="page-title">
          <h1>New inspection</h1>
          {live ? (
            <span className={`pill ${recorder.state === "paused" ? "warning" : "error"}`}>
              {recorder.state === "paused" ? "paused" : "recording"}
            </span>
          ) : pending ? (
            <span className="pill warning">ready to process</span>
          ) : null}
        </div>
        <p className="page-meta">
          {live
            ? "Capturing locally — the network is not in this path"
            : "Record on the floor, or drop a recording you already have. Both go through the same intake."}
        </p>
      </header>

      {/* A take left behind by a tab that died. Each second of audio is written
          to IndexedDB as it is captured, so this is the recovery path, not a
          warning. Shown only with the intake idle, or it could be mistaken for
          the take already in hand. */}
      {!live && !pending && stored.length > 0 && (
        <div className="notice recover" style={{ marginTop: 24 }} role="status">
          <b>
            {stored.length === 1
              ? "A recording on this device was left unprocessed."
              : `${stored.length} recordings on this device were left unprocessed.`}
          </b>{" "}
          Rebuild one and it goes through the ordinary intake, where you pick the style and
          press Process.
          {stored.map((session) => (
            <div className="row" key={session.id} style={{ marginTop: 10 }}>
              <span className="grow">
                <b>{session.filename}</b>
                {session.ms ? <> &middot; {hms(session.ms)}</> : null}
                {session.status === "recording" ? (
                  <em> &middot; the tab closed while this was still recording</em>
                ) : null}
              </span>
              <button
                className="btn sm"
                onClick={() => void recover(session)}
                disabled={recovering}
              >
                {recovering ? "Rebuilding…" : "Recover"}
              </button>
              <button
                className="btn danger sm"
                onClick={() => void forget(session.id)}
                disabled={recovering}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {live ? (
        /* The recorder. Deep teal, one of the six brand fills: this is the
           loudest state the product has, and it should look like it. */
        <section style={{ marginTop: 24 }}>
          <div className="recorder">
            <div className="row">
              <span
                className={`recdot${recorder.state === "paused" ? " held" : ""}`}
                aria-hidden="true"
              />
              <span className="clock" role="timer">
                {hms(recorder.ms)}
              </span>
              <span className="state">
                {recorder.state === "paused" ? "paused" : "recording"}
              </span>
              <span className="spacer" />
              {recorder.state === "paused" ? (
                <button className="btn on-color sm" onClick={recorder.resume}>
                  Resume
                </button>
              ) : (
                <button className="btn on-color sm" onClick={recorder.pause}>
                  Pause
                </button>
              )}
              <button className="btn on-color sm" onClick={recorder.finish}>
                Done
              </button>
              <button className="btn on-dark sm" onClick={recorder.discard}>
                Discard
              </button>
            </div>

            <Waveform levels={recorder.levels} sample={recorder.sample} />

            <div className="transcript">
              <LiveTranscript
                status={transcript.status}
                error={transcript.error}
                utterances={transcript.utterances}
                partial={transcript.partial}
                live
                events={transcript.events}
              />
            </div>
          </div>
        </section>
      ) : (
        <section style={{ marginTop: 24 }}>
          <div className={`intake${take || picked ? (dragging ? " dragging" : "") : " plain"}`}>
            {take ? (
              <>
                <div className="row">
                  <div className="grow">
                    <div className="hint" style={{ marginBottom: 6 }}>
                      <b>{take.file.name}</b> &middot; {hms(take.ms)} &middot;{" "}
                      {megabytes(take.file.size)}
                    </div>
                    <audio controls preload="none" src={previewUrl} />
                  </div>
                  <button
                    className="btn"
                    onClick={() => void process()}
                    disabled={progress >= 0}
                  >
                    Process this recording
                  </button>
                  <button className="btn danger" onClick={clear} disabled={progress >= 0}>
                    Discard
                  </button>
                </div>
                <span className="hint">
                  Play it back before processing &mdash; transcription takes several minutes,
                  and a recording nobody can hear costs all of it.
                </span>
              </>
            ) : picked ? (
              <div className="row">
                <span className="grow hint">
                  <b>{picked.name}</b> &middot; {megabytes(picked.size)} &middot; ready to
                  process
                </span>
                <button
                  className="btn"
                  onClick={() => void process()}
                  disabled={progress >= 0}
                >
                  Process this recording
                </button>
                <button className="btn danger" onClick={clear} disabled={progress >= 0}>
                  Clear
                </button>
              </div>
            ) : (
              <>
                <div className="row">
                  <button
                    className="btn"
                    onClick={() => void recorder.start()}
                    disabled={!recorder.supported}
                    title={recorder.supported ? undefined : recorder.blockedReason}
                  >
                    {recorder.supported ? "Record inspection" : "Recording unavailable here"}
                  </button>
                  <span className="hint">
                    {recorder.supported
                      ? "The microphone is the normal path. The zone below is for a take from another device."
                      : "Open the app on 127.0.0.1 to record, or bring a file in below."}
                  </span>
                </div>

                {/* The library's upload zone, which is the shape this product
                    already uses for "a file goes here". The input lives inside
                    the label, so there is no stray "No file chosen" control
                    parked at the bottom of the screen. */}
                <label className={`dropzone${dragging ? " over" : ""}`} style={{ marginTop: 16 }}>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".mp3,.mp4,.m4a,.wav,.webm,.mpeg,.mpga"
                    onChange={(e) => choose(e.target.files?.[0])}
                    hidden
                  />
                  <span className="big">Drop a recording here</span>
                  <span className="small">
                    or click to choose a file &middot; mp3, m4a, wav, webm
                  </span>
                </label>
              </>
            )}

            <div className="opts">
              <label htmlFor="style">Check against</label>
              <select
                id="style"
                value={styleNo}
                onChange={(e) => setStyleNo(e.target.value)}
              >
                <option value="">Style announced in the recording</option>
                {styleSets?.length === 0 && (
                  <option value="" disabled>
                    {styleError || "No sheets in data/StyleSets"}
                  </option>
                )}
                {styleSets?.map((style) => (
                  <option key={style} value={style}>
                    Style {style}
                  </option>
                ))}
              </select>
              <span className="hint">
                {styleSets?.length
                  ? `${styleSets.length} sheet${styleSets.length === 1 ? "" : "s"} in the library`
                  : "The library is empty"}
              </span>
            </div>

            <div className="opts">
              <label htmlFor="where">Where</label>
              {locating ? (
                <span className="hint">Asking this device&hellip;</span>
              ) : located ? (
                <>
                  <span className="pill">{location || coords}</span>
                  <span className="hint">
                    {coords}
                    {accuracy ? <> &middot; to within {Math.round(accuracy)} m</> : null} &middot;{" "}
                    <button type="button" className="link" onClick={() => setLocated(false)}>
                      type it instead
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <input
                    id="where"
                    placeholder="e.g. Unit 2, bench 4"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    style={{ maxWidth: 240 }}
                  />
                  <span className="hint">Recorded with the inspection, for the audit trail</span>
                </>
              )}
            </div>

            {progress >= 0 && (
              <div className="bar" style={{ marginTop: 12 }}>
                <i style={{ width: `${progress * 100}%` }} />
              </div>
            )}
          </div>
        </section>
      )}

      {!live && !pending && (
        <section>
          <div className="section-head">
            <h2>Before you start</h2>
          </div>
          <p className="lede">
            Recording is local. The take is written to this device a second at a time, so a
            closed tab or a flat battery costs you the tail of it and not the inspection.
            Nothing reaches the server until you press Process.
          </p>
        </section>
      )}

      {live && (
        <section>
          <div className="section-head">
            <h2>While this runs</h2>
          </div>
          <p className="lede">
            Recording is local. Losing the network costs you the live monitor above and nothing
            else — the take is written to this device a second at a time, so a crash or a
            closed tab is recoverable up to the moment it happened.
          </p>
          <dl className="readout">
            <div>
              <dt>Captured</dt>
              <dd>{hms(recorder.ms)}</dd>
            </div>
            <div>
              <dt>Sound level</dt>
              <dd>{recorder.silent ? "silent" : "ok"}</dd>
            </div>
            <div>
              <dt>Live monitor</dt>
              <dd className="sizes">
                {transcript.status === "live"
                  ? "on"
                  : transcript.status === "connecting"
                    ? "connecting"
                    : transcript.status === "error"
                      ? "off"
                      : "off"}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {live && recorder.silent && (
        <section>
          <div className="section-head">
            <h2>If the room goes quiet</h2>
          </div>
          <div className="notice warn">
            <b>No sound detected.</b> The microphone is open but nothing has come through for
            several seconds. Check the headset before carrying on — a silent take cannot be
            graded, and you will not know until the transcript comes back empty.
          </div>
        </section>
      )}

      {/* What the monitor heard for the take in hand, kept after the stream
          ends so it can be read before pressing Process. */}
      {!live && heard.length > 0 && (
        <section>
          <div className="transcript" style={{ marginTop: 0 }}>
            <LiveTranscript
              status="off"
              error=""
              utterances={heard}
              partial=""
              live={false}
              events={transcript.events}
            />
          </div>
        </section>
      )}

      {error && (
        <div className="notice bad" role="alert" style={{ marginTop: 20 }}>
          <b>{error}</b>
        </div>
      )}

    </div>
  );
}
