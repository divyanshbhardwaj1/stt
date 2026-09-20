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
  children: React.ReactNode;
}

/**
 * The recorder, top of the work pane.
 *
 * Sticky, because it is the primary action and because a running waveform
 * should stay visible while a reviewer scrolls the report underneath it.
 */
export function Intake({ onQueued, children }: Props) {
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
  const [styleSets, setStyleSets] = useState<string[] | null>(null);
  const [styleError, setStyleError] = useState("");
  const [progress, setProgress] = useState(-1); // -1 = not uploading
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

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
      const job = await uploadRecording(pending, styleNo, monitor, setProgress);
      setProgress(-1);
      clear();
      onQueued(job);
    } catch (cause) {
      setProgress(-1);
      setUploadError(cause instanceof Error ? cause.message : "Upload failed.");
    }
  }, [pending, styleNo, heard, savedTranscript, clear, onQueued]);

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (live) return; // never swap the take mid-recording
    choose(event.dataTransfer?.files?.[0]);
  };

  const error = uploadError || recorder.error || styleError;
  // The transcript owns the pane while recording, and stays afterwards for as
  // long as the take it belongs to is still in hand.
  const showTranscript = live || heard.length > 0;

  return (
    <>
    <div
      className={`intake${dragging ? " dragging" : ""}${live ? " live" : ""}`}
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
      <div className="inner">
        {/* Anything the server has never accepted. Shown only with the intake
            idle, so it cannot be mistaken for the take already in hand. */}
        {!live && !pending && stored.length > 0 && (
          <div className="msg recover" role="status">
            <b>
              {stored.length === 1
                ? "A recording on this device has not been processed"
                : `${stored.length} recordings on this device have not been processed`}
            </b>
            <ul>
              {stored.map((session) => (
                <li key={session.id}>
                  <span>
                    <b>{session.filename}</b>
                    {session.ms ? <> &middot; {hms(session.ms)}</> : null}
                    {session.status === "recording" ? (
                      <em> &middot; the tab closed while this was still recording</em>
                    ) : null}
                  </span>
                  <span className="row tight">
                    <button onClick={() => void recover(session)} disabled={recovering}>
                      {recovering ? "Rebuilding…" : "Recover"}
                    </button>
                    <button
                      className="danger"
                      onClick={() => void forget(session.id)}
                      disabled={recovering}
                    >
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {live ? (
          <>
            <div className="row">
              <span
                className={`recdot${recorder.state === "paused" ? " held" : ""}`}
                aria-hidden="true"
              />
              <span className="clock" role="timer">
                {hms(recorder.ms)}
              </span>
              <span className={`state ${recorder.state === "paused" ? "held" : "on"}`}>
                {recorder.state === "paused" ? "Paused" : "Recording"}
              </span>
              <span className="spacer" />
              <div className="row tight">
                {recorder.state === "paused" ? (
                  <button className="ghost" onClick={recorder.resume}>
                    Resume
                  </button>
                ) : (
                  <button className="ghost" onClick={recorder.pause}>
                    Pause
                  </button>
                )}
                <button onClick={recorder.finish}>Done</button>
                <button className="danger" onClick={recorder.discard}>
                  Discard
                </button>
              </div>
            </div>
            <Waveform levels={recorder.levels} sample={recorder.sample} />
            {recorder.silent && (
              <div className="silence" role="status">
                <b>No sound detected.</b>
                <span>
                  Nothing has reached the microphone for a few seconds. Check that the right input
                  is selected and that it is not muted.
                </span>
              </div>
            )}
          </>
        ) : take ? (
          <>
            <div className="row">
              <div className="spacer">
                <div className="hint" style={{ marginBottom: 6 }}>
                  <b>{take.file.name}</b> &middot; {hms(take.ms)} &middot;{" "}
                  {megabytes(take.file.size)}
                </div>
                <audio controls preload="none" src={previewUrl} />
              </div>
              <div className="row tight">
                <button onClick={() => void process()} disabled={progress >= 0}>
                  Process this recording
                </button>
                <button className="danger" onClick={clear} disabled={progress >= 0}>
                  Discard
                </button>
              </div>
            </div>
            <p className="hint" style={{ margin: "9px 0 0" }}>
              Play it back before processing &mdash; transcription takes several minutes, and a
              recording nobody can hear costs all of it.
            </p>
          </>
        ) : picked ? (
          <div className="row">
            <div className="spacer hint">
              <b>{picked.name}</b> &middot; {megabytes(picked.size)} &middot; ready to process
            </div>
            <div className="row tight">
              <button onClick={() => void process()} disabled={progress >= 0}>
                Process this recording
              </button>
              <button className="danger" onClick={clear} disabled={progress >= 0}>
                Clear
              </button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button
              onClick={() => void recorder.start()}
              disabled={!recorder.supported}
              title={recorder.supported ? undefined : recorder.blockedReason}
            >
              {recorder.supported ? "Record inspection" : "Recording unavailable here"}
            </button>
            <span className="hint">
              {recorder.supported ? (
                <>
                  or{" "}
                  <span className="pickfile" onClick={() => fileInput.current?.click()}>
                    choose a recording
                  </span>{" "}
                  &mdash; drop one anywhere here
                </>
              ) : (
                <>
                  Open the app on <b>127.0.0.1</b> to record, or drop a file.
                </>
              )}
            </span>
          </div>
        )}

        {!live && (
          <div className="opts" style={{ marginTop: 11 }}>
            <label htmlFor="style">Check against</label>
            <select id="style" value={styleNo} onChange={(e) => setStyleNo(e.target.value)}>
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
          </div>
        )}

        {progress >= 0 && (
          <div className="bar">
            <i style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        {error && (
          <div className="msg bad" role="alert">
            {error}
          </div>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".mp3,.mp4,.m4a,.wav,.webm,.mpeg,.mpga"
        onChange={(e) => choose(e.target.files?.[0])}
      />
    </div>

    <div className="pane">
      {showTranscript ? (
        <LiveTranscript
          status={transcript.status}
          error={transcript.error}
          utterances={live ? transcript.utterances : heard}
          partial={live ? transcript.partial : ""}
          live={live}
          events={transcript.events}
        />
      ) : (
        children
      )}
    </div>
    </>
  );
}
