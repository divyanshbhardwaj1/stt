import { useEffect, useRef, useState } from "react";

/**
 * Live transcription of the microphone, over WebRTC.
 *
 * WebRTC rather than a WebSocket carrying PCM: the browser already holds the
 * MediaStream, so addTrack hands the audio over and the platform does the
 * resampling, encoding and packetisation. That removes an AudioWorklet, the
 * float-to-int16 conversion and the base64 framing entirely.
 *
 * The credential is a short-lived secret minted by POST /api/realtime-token;
 * the account key stays on the server and the audio goes browser-to-API, so a
 * half-hour of it never touches our process.
 *
 * What this produces is a MONITOR. It is saved for audit alongside the batch
 * transcripts, but nothing downstream reads it: a latency-tuned model trades
 * away recall of exactly the short unstressed words ("okay", "minus one by
 * eight") that the two-pass batch design exists to protect.
 */

export type LiveStatus = "off" | "connecting" | "live" | "error";

/**
 * One stretch of speech, from when the speaker started to when they paused.
 *
 * The model decides the boundaries: it commits an utterance when the talking
 * stops, which is why a pause naturally starts a new line. `at` is the
 * recorded position, so a reviewer reading a line knows where to scrub back to.
 */
export interface Utterance {
  at: number;
  text: string;
}

/** The saved form: one timestamped line per utterance. */
export const transcriptText = (utterances: Utterance[]): string =>
  utterances.map(({ at, text }) => `[${clockOf(at)}] ${text}`).join("\n");

function clockOf(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return total >= 3600
    ? `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
    : `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

/**
 * OpenAI's realtime entry point. The minted token authorises this exchange.
 *
 * No `?model=` query parameter: the session - its type, its transcription model,
 * the prompt and the keywords - is bound to the token when the server mints it.
 * That query slot names a realtime *conversational* model, so passing a
 * transcription model there is refused with "not supported in transcription
 * mode" and a bare 400 in the console.
 */
const REALTIME_URL = "https://api.openai.com/v1/realtime/calls";

interface Session {
  /** Which recording this transcript belongs to, so a stale one is discardable. */
  stream: MediaStream | null;
  status: LiveStatus;
  error: string;
  /** Finalised utterances, oldest first. */
  utterances: Utterance[];
  /** The utterance still being spoken. */
  partial: string;
  /** Where the open line began, so it is stamped from its first word. */
  partialAt: number;
  /** The recorder's pause count when the open line started. */
  openedAt: number;
  /**
   * Every event type the service has sent, with counts.
   *
   * Kept because "nothing is appearing" has several causes that look identical
   * on screen - no audio reaching the service, audio arriving but no
   * transcription events, or events arriving under names this code does not
   * recognise. Without this the only way to tell them apart is a browser
   * console the operator does not have open.
   */
  events: Record<string, number>;
}

const BLANK: Session = {
  stream: null,
  status: "off",
  error: "",
  utterances: [],
  partial: "",
  partialAt: 0,
  openedAt: 0,
  events: {},
};

export function useLiveTranscript(
  stream: MediaStream | null,
  paused: boolean,
  elapsed: () => number,
  pauses: number,
) {
  const [session, setSession] = useState<Session>(BLANK);

  // Read at commit time from inside a socket callback, so it is held in a ref
  // rather than closed over: a stale clock would misdate every line.
  const clock = useRef(elapsed);
  useEffect(() => {
    clock.current = elapsed;
  }, [elapsed]);

  // Also read from inside the socket callback, for the same reason.
  const pauseCount = useRef(pauses);
  useEffect(() => {
    pauseCount.current = pauses;
  }, [pauses]);

  const peer = useRef<RTCPeerConnection | null>(null);
  const sender = useRef<RTCRtpSender | null>(null);
  const monitorTrack = useRef<MediaStreamTrack | null>(null);

  // Derived rather than reset in an effect: a session recorded against an
  // earlier stream simply is not this one's, so a new recording starts blank
  // without a render pass spent clearing it.
  const current: Session =
    session.stream === stream ? session : { ...BLANK, status: stream ? "connecting" : "off" };

  useEffect(() => {
    if (!stream) return;

    let cancelled = false;

    /** Only touch state that still belongs to this stream. */
    const update = (change: (previous: Session) => Partial<Session>) =>
      setSession((previous) => {
        const base = previous.stream === stream ? previous : { ...BLANK, stream };
        return { ...base, ...change(base) };
      });

    const connect = async () => {
      // Only `value` is needed here; the session's model travels inside it.
      let token: { value: string };
      try {
        const response = await fetch("/api/realtime-token", { method: "POST" });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.detail || `token endpoint returned ${response.status}`);
        }
        token = await response.json();
      } catch (cause) {
        if (cancelled) return;
        // Recording must never depend on transcription being reachable.
        update(() => ({
          status: "error",
          error: cause instanceof Error ? cause.message : "could not start live transcription",
        }));
        return;
      }
      if (cancelled) return;

      const connection = new RTCPeerConnection();
      peer.current = connection;

      // Events arrive on this channel: partial deltas, then a completed item.
      const events = connection.createDataChannel("oai-events");
      events.onmessage = (message: MessageEvent<string>) => {
        let event: { type?: string; delta?: string; transcript?: string };
        try {
          event = JSON.parse(message.data);
        } catch {
          return;
        }

        const kind = event.type ?? "unknown";
        update((previous) => ({
          events: { ...previous.events, [kind]: (previous.events[kind] ?? 0) + 1 },
        }));

        if (event.type?.endsWith("input_audio_transcription.delta") && event.delta) {
          const delta = event.delta;
          update((previous) => {
            const boundary = pauseCount.current;
            // The model streams one unbroken caption, so the line break is made
            // here: this word is the first since the speaker paused, which means
            // everything before it belongs to the line that just ended. Breaking
            // on the resumed word rather than on the silence itself is what keeps
            // late-arriving deltas out of the wrong line.
            if (previous.partial && boundary !== previous.openedAt) {
              return {
                utterances: [
                  ...previous.utterances,
                  { at: previous.partialAt, text: previous.partial.trim() },
                ],
                partial: delta,
                partialAt: clock.current(),
                openedAt: boundary,
              };
            }
            return {
              partial: previous.partial + delta,
              partialAt: previous.partial ? previous.partialAt : clock.current(),
              openedAt: boundary,
            };
          });
        } else if (event.type?.endsWith("input_audio_transcription.completed")) {
          const finished = (event.transcript ?? "").trim();
          // Kept for models that do commit segments; gpt-live-transcribe does
          // not send this at all, which is why the delta path above segments.
          update((previous) => ({
            partial: "",
            utterances: finished
              ? [...previous.utterances, { at: previous.partialAt, text: finished }]
              : previous.utterances,
          }));
        }
      };

      // A CLONE of the microphone track, not the track itself: pausing the
      // monitor stops this copy, and the recorder's own track - the one that
      // becomes the actual report - is left strictly alone.
      const source = stream.getAudioTracks()[0];
      if (source) {
        const clone = source.clone();
        monitorTrack.current = clone;
        sender.current = connection.addTrack(clone, stream);
      }

      connection.onconnectionstatechange = () => {
        const state = connection.connectionState;
        if (state === "connected") update(() => ({ status: "live", error: "" }));
        else if (state === "failed" || state === "disconnected") {
          // Say so rather than freezing: a panel that silently stops updating
          // reads as "nobody is talking", which is the wrong conclusion.
          update(() => ({
            status: "error",
            error: "live transcription lost its connection - the recording is unaffected",
          }));
        }
      };

      try {
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);

        const answer = await fetch(REALTIME_URL, {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${token.value}`,
            "Content-Type": "application/sdp",
          },
        });
        if (!answer.ok) {
          // Carry the upstream reason through. A bare status code sends you
          // reading network traces for something the response already said.
          const body = await answer.text().catch(() => "");
          let reason = body.slice(0, 200);
          try {
            reason = JSON.parse(body).error?.message ?? reason;
          } catch {
            /* not JSON; the raw body is the best available reason */
          }
          throw new Error(
            `realtime handshake failed (${answer.status})${reason ? `: ${reason}` : ""}`,
          );
        }
        const sdp = await answer.text();
        if (cancelled) return;

        await connection.setRemoteDescription({ type: "answer", sdp });
      } catch (cause) {
        if (cancelled) return;
        update(() => ({
          status: "error",
          error: cause instanceof Error ? cause.message : "live transcription failed to start",
        }));
      }
    };

    void connect();

    return () => {
      cancelled = true;
      monitorTrack.current?.stop();
      monitorTrack.current = null;
      peer.current?.close();
      peer.current = null;
      sender.current = null;
    };
  }, [stream]);

  // Pausing the recorder pauses the monitor, without tearing down the session:
  // replaceTrack(null) stops sending audio with no renegotiation, so the
  // transcript so far survives a pause and no audio is billed during one.
  useEffect(() => {
    const active = sender.current;
    if (!active) return;
    void active.replaceTrack(paused ? null : monitorTrack.current).catch(() => {
      /* the session is already gone; the connection handler reports it */
    });
  }, [paused]);

  return {
    status: current.status,
    error: current.error,
    events: current.events,
    utterances: current.utterances,
    partial: current.partial,
    /**
     * Every line including the one still open.
     *
     * What gets saved when a recording stops: the last thing said is still an
     * open partial at that moment, and dropping it would lose the final line.
     */
    lines: current.partial
      ? [...current.utterances, { at: current.partialAt, text: current.partial.trim() }]
      : current.utterances,
  };
}
