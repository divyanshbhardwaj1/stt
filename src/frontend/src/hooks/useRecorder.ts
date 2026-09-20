import { useCallback, useEffect, useRef, useState } from "react";
import { appendChunk, dropSession, keepStorage, startSession } from "../recordingStore";

/**
 * Capture, as a state machine: idle -> recording <-> paused -> idle.
 *
 * MediaRecorder for capture and an AnalyserNode for the level meter, both
 * native. The containers MediaRecorder produces - webm/opus on Chrome, Edge
 * and Firefox, mp4/aac on Safari - are already accepted by POST /api/jobs, so
 * a recording made here rides the identical upload path as a dropped file.
 */

const CONTAINERS: Record<string, string> = {
  "audio/webm": ".webm",
  "audio/mp4": ".mp4",
};

// Browser DSP is tuned for video calls: one near voice, everything else
// suppressed. An inspection is two people at arm's length in a factory, and
// the words that get eaten first are the short unstressed ones - "okay",
// "minus one by eight" - which are the entire point of the recording. So the
// noise gates come off and only gain control stays on, for the second speaker.
// ponytail: tune here if a site's recordings come back clipped or noisy.
const MIC: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
};

/** Below this RMS a frame counts as silence; past this long, say so. */
const FLOOR = 0.012;
const SILENT_MS = 4000;

/**
 * How long a gap has to be before it counts as the speaker pausing.
 *
 * The live transcript breaks a line when speech resumes after one of these,
 * because the transcription model streams continuously and offers no segment
 * boundaries of its own. Deliberately above the hesitation inside a single
 * dictation - an inspector pauses between the point of measure, the value and
 * the verdict - and below the gap before the next point of measure.
 *
 * ponytail: reuses FLOOR, so a loud room registers fewer pauses and the lines
 * simply run longer. Raise FLOOR for the pause test if a factory floor never
 * goes quiet enough to break a line.
 */
const PAUSE_MS = 700;
/** Ring the level history so a forty-minute session cannot grow without bound. */
const MAX_BARS = 2000;

export type RecorderState = "idle" | "recording" | "paused";

export interface Take {
  file: File;
  /** Recorded duration in milliseconds, excluding any paused stretches. */
  ms: number;
  /**
   * Where this take is stored until the server has it.
   *
   * Carried so the caller can forget the recording once it is uploaded, and
   * only then — dropping it any earlier is how a failed upload becomes a lost
   * inspection.
   */
  sessionId: string;
}

function container(): string {
  return Object.keys(CONTAINERS).find((type) => MediaRecorder?.isTypeSupported?.(type)) ?? "";
}

function stamp(): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function useRecorder(onTake: (take: Take) => void) {
  const [state, setState] = useState<RecorderState>("idle");
  /** The live microphone stream, so a monitor can tap the same audio. */
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  /**
   * Increments each time speech resumes after a pause.
   *
   * A counter rather than a boolean: the transcript only needs to know that a
   * boundary happened, and a number cannot be missed between renders the way a
   * flag being set and cleared can.
   */
  const [pauses, setPauses] = useState(0);
  const [ms, setMs] = useState(0);
  const [silent, setSilent] = useState(false);
  const [error, setError] = useState("");

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const context = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const startedAt = useRef(0);
  const accumulated = useRef(0);
  const lastSound = useRef(0);
  /** When the current stretch of quiet began, or 0 while speech is running. */
  const quietSince = useRef(0);
  const discarding = useRef(false);
  const takeMs = useRef(0);
  /** The recording being written to storage, and the next chunk's position in it. */
  const session = useRef({ id: "", filename: "" });
  const seq = useRef(0);

  /** Level history, newest last. Read by <Waveform/>; never render state. */
  const levels = useRef<number[]>([]);

  // The callback lands in MediaRecorder.onstop, which outlives the render that
  // created it, so it is held in a ref rather than captured.
  const deliver = useRef(onTake);
  useEffect(() => {
    deliver.current = onTake;
  }, [onTake]);

  const elapsed = useCallback(
    () =>
      accumulated.current +
      (recorder.current?.state === "recording" ? Date.now() - startedAt.current : 0),
    [],
  );

  const teardown = useCallback(() => {
    // Stopping the tracks is what turns off the browser's recording indicator.
    // Without it the tab looks like it is still listening.
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setLiveStream(null);
    analyser.current = null;
    void context.current?.close().catch(() => {});
    context.current = null;
  }, []);

  const start = useCallback(async () => {
    setError("");
    const type = container();
    if (!navigator.mediaDevices?.getUserMedia || !type) {
      setError("This browser cannot record audio. Drop a recording instead.");
      return;
    }

    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: MIC });
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : "unknown";
      setError(
        name === "NotAllowedError"
          ? "Microphone blocked. Allow access in the browser's site settings, then try again."
          : `No microphone available (${name}).`,
      );
      return;
    }

    stream.current = media;
    setLiveStream(media);
    chunks.current = [];
    levels.current = [];
    accumulated.current = 0;
    discarding.current = false;
    lastSound.current = Date.now();
    quietSince.current = 0;
    setPauses(0);

    // Named at the start rather than at the stop, so a recording recovered
    // after a crash carries the name it would have had.
    const started = stamp();
    session.current = {
      id: `${started}-${Math.random().toString(36).slice(2, 8)}`,
      filename: `inspection-${started}${CONTAINERS[type]}`,
    };
    seq.current = 0;
    void keepStorage();
    void startSession({
      id: session.current.id,
      filename: session.current.filename,
      mimeType: type,
      startedAt: Date.now(),
      ms: 0,
      status: "recording",
      liveTranscript: "",
    });

    const machine = new MediaRecorder(media, { mimeType: type });
    machine.ondataavailable = (event) => {
      if (!event.data.size) return;
      chunks.current.push(event.data);
      // Written as it arrives, not gathered up at the end: the end is exactly
      // the moment we do not get to if the tab is killed. Not awaited — a slow
      // write must never hold up capture, and a lost chunk costs a second.
      void appendChunk(session.current.id, seq.current++, event.data);
    };
    machine.onerror = () => setError("Recording stopped unexpectedly.");
    machine.onstop = () => {
      const blob = new Blob(chunks.current, { type });
      const duration = takeMs.current;
      chunks.current = [];
      recorder.current = null;
      teardown();
      setState("idle");
      setSilent(false);

      const { id, filename } = session.current;
      if (discarding.current) {
        discarding.current = false;
        void dropSession(id);
        return;
      }
      if (!blob.size) {
        setError("Nothing was recorded. Check the microphone and try again.");
        void dropSession(id);
        return;
      }
      // Not marked stopped here. The consumer does that in one write, once it
      // has the duration AND the monitor's text: two read-modify-writes racing
      // each other drop whichever field lost, and a recovered take with a
      // duration of zero is a lie about what is on the device.
      // A File, not a Blob: the upload path reads .name for the report name,
      // and the server names the transcript and every output after it.
      deliver.current({ file: new File([blob], filename, { type }), ms: duration, sessionId: id });
    };

    // Level metering taps the same MediaStream; it does not affect capture.
    const audio = new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const node = audio.createAnalyser();
    node.fftSize = 1024;
    node.smoothingTimeConstant = 0.55;
    audio.createMediaStreamSource(media).connect(node);
    context.current = audio;
    analyser.current = node;

    recorder.current = machine;
    machine.start(1000);
    startedAt.current = Date.now();
    setMs(0);
    setState("recording");
  }, [teardown]);

  const pause = useCallback(() => {
    if (recorder.current?.state !== "recording") return;
    recorder.current.pause();
    accumulated.current += Date.now() - startedAt.current;
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    if (recorder.current?.state !== "paused") return;
    recorder.current.resume();
    startedAt.current = Date.now();
    lastSound.current = Date.now();
    setState("recording");
  }, []);

  const stop = useCallback(
    (drop: boolean) => {
      const machine = recorder.current;
      if (!machine || machine.state === "inactive") return;
      if (machine.state === "recording") accumulated.current += Date.now() - startedAt.current;
      takeMs.current = accumulated.current;
      discarding.current = drop;
      machine.stop(); // onstop finalises or drops the take
    },
    [],
  );

  const finish = useCallback(() => stop(false), [stop]);
  const discard = useCallback(() => stop(true), [stop]);

  /**
   * One frame of the level meter. Called by <Waveform/> from its animation
   * loop, so sampling and painting share a single rAF rather than two.
   */
  const sample = useCallback(() => {
    const node = analyser.current;
    if (!node || recorder.current?.state !== "recording") return;
    const buffer = new Uint8Array(node.fftSize);
    node.getByteTimeDomainData(buffer);
    let sum = 0;
    for (const value of buffer) {
      const centred = (value - 128) / 128;
      sum += centred * centred;
    }
    const rms = Math.sqrt(sum / buffer.length);
    levels.current.push(rms);
    if (levels.current.length > MAX_BARS) levels.current.shift();

    const now = Date.now();
    if (rms < FLOOR) {
      if (!quietSince.current) quietSince.current = now;
      return;
    }
    // Speech. Count the boundary on resume rather than when the gap is first
    // long enough: by then every word said before the pause has had the whole
    // gap to arrive, so none of them land on the wrong line.
    if (quietSince.current && now - quietSince.current >= PAUSE_MS) {
      setPauses((count) => count + 1);
    }
    quietSince.current = 0;
    lastSound.current = now;
  }, []);

  // Clock and silence alarm. 250ms is fast enough to read as a running timer
  // without re-rendering the tree on every animation frame.
  useEffect(() => {
    if (state === "idle") return;
    const id = setInterval(() => {
      setMs(elapsed());
      // Not while the tab is hidden: requestAnimationFrame is suspended there,
      // so lastSound goes stale and the alarm would cry wolf on a healthy
      // recording.
      setSilent(
        state === "recording" && !document.hidden && Date.now() - lastSound.current > SILENT_MS,
      );
    }, 250);
    return () => clearInterval(id);
  }, [state, elapsed]);

  // Give the meter a fresh baseline when the tab comes back, so the alarm
  // judges only what it has actually had a chance to hear.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) lastSound.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // A tab closed mid-recording takes the audio with it.
  useEffect(() => () => teardown(), [teardown]);

  const supported =
    typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia && !!container();

  return {
    state,
    liveStream,
    ms,
    /** Recorded milliseconds right now, so a caller can stamp an event. */
    elapsed,
    pauses,
    silent,
    error,
    setError,
    levels,
    sample,
    start,
    pause,
    resume,
    finish,
    discard,
    supported,
    /** getUserMedia needs a secure context; a plain-http LAN address is not one. */
    blockedReason: window.isSecureContext
      ? "This browser cannot record audio - drop a file instead"
      : "Recording needs https or localhost - open the app on 127.0.0.1, or drop a file",
  };
}
