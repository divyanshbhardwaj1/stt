import { useEffect, useRef, useState } from "react";
import { hms } from "../format";
import type { LiveStatus, Utterance } from "../hooks/useLiveTranscript";

interface Props {
  status: LiveStatus;
  error: string;
  /** Finalised utterances, oldest first. */
  utterances: Utterance[];
  /** The words still being spoken. Empty once the recording stops. */
  partial: string;
  /** False when this is the finished transcript of a take, not a live one. */
  live: boolean;
  /** Event types received from the service, for when nothing is appearing. */
  events?: Record<string, number>;
}

/**
 * What the microphone is hearing, as it hears it.
 *
 * One line per utterance, oldest at the top: while someone keeps talking the
 * line grows, and when they pause the model closes it and the next line starts.
 * That gives the page the shape of the inspection itself - one point of measure
 * per line, in the order they were called.
 *
 * Each line carries its position in the recording, because the job every open
 * question ends in is "listen back to it": a timestamp turns that from a hunt
 * into a scrub.
 *
 * A monitor, and labelled as one. The report is built later from the batch
 * transcription of the uploaded file, which is more thorough than this.
 */
export function LiveTranscript({ status, error, utterances, partial, live, events }: Props) {
  const scroller = useRef<HTMLDivElement | null>(null);
  /** Follow the newest line, unless the operator has scrolled back to read. */
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (!pinned) return;
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [utterances, partial, pinned]);

  const empty = utterances.length === 0 && !partial;

  return (
    <>
      <div className="section-head" style={{ marginBottom: 8 }}>
        <h2 style={{ font: "var(--text-title-sm)" }}>
          {live ? "Live transcript" : "Heard while recording"}
        </h2>
        <span
          className={`pill ${
            status === "live"
              ? "success"
              : status === "connecting"
                ? "warning"
                : status === "error"
                  ? "error"
                  : ""
          }`}
        >
          {status === "live"
            ? "connected"
            : status === "connecting"
              ? "connecting"
              : status === "error"
                ? "unavailable"
                : "saved"}
        </span>
        <span className="spacer" />
        <span className="dim" style={{ font: "var(--text-caption)" }}>
          monitor only — the report is transcribed again afterwards
        </span>
      </div>

      {status === "error" && !utterances.length ? (
        <p className="lede">
          {error || "Live transcription is unavailable."} The recording itself is unaffected and
          will still produce a full report.
        </p>
      ) : (
        <div
          className="feed-body"
          ref={scroller}
          role="log"
          aria-live="polite"
          aria-label="Live transcription"
          onScroll={(event) => {
            const box = event.currentTarget;
            // 32px of slack, so a near-bottom scroll still counts as following.
            setPinned(box.scrollHeight - box.scrollTop - box.clientHeight < 32);
          }}
        >
          {empty ? (
            <>
              <p className="lede">
                {status === "connecting"
                  ? "Connecting to the transcription service…"
                  : status === "error"
                    ? error
                    : "Waiting for speech. Read a point of measure aloud and it will appear here."}
              </p>
              {/* Connected and listening but nothing has come back. Show what
                  the service actually sent: no events at all means the audio
                  is not reaching it, whereas events under unexpected names
                  mean it is talking and this code is not listening. */}
              {live && status === "live" && (
                <p className="lede dim">
                  {events && Object.keys(events).length
                    ? `Service events so far: ${Object.entries(events)
                        .map(([name, count]) => `${name} ×${count}`)
                        .join(", ")}`
                    : "No events received from the transcription service yet."}
                </p>
              )}
            </>
          ) : (
            <ul className="lines">
              {utterances.map((utterance) => (
                <li key={`${utterance.at}-${utterance.text}`}>
                  <span className="t">{hms(utterance.at)}</span>
                  <span>{utterance.text}</span>
                </li>
              ))}
              {/* The line still being spoken. Italic and muted in the
                  prototype, because it is not settled text yet. */}
              {partial && (
                <li className="partial">
                  <span className="t" />
                  <span>{partial}…</span>
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {!pinned && (
        <button className="btn secondary sm" onClick={() => setPinned(true)}>
          Jump to newest
        </button>
      )}
    </>
  );
}
