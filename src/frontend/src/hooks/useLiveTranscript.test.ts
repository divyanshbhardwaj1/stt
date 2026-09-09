import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { transcriptText, useLiveTranscript } from "./useLiveTranscript";

/**
 * The live monitor.
 *
 * The behaviours worth pinning are the ones that protect the recording: the
 * monitor must never touch the recorder's own microphone track, a failure to
 * reach the transcription service must not read as silence, and a pause must
 * stop sending audio without discarding the transcript so far.
 */

interface Channel {
  onmessage: ((event: { data: string }) => void) | null;
}

let channel: Channel;
let connection: FakePeer;
let handshakeUrl: string;
let recordedMs: number;
const clock = () => recordedMs;
let addedTracks: MediaStreamTrack[];
let replaced: (MediaStreamTrack | null)[];
let clonesStopped: number;

class FakeSender {
  track: MediaStreamTrack | null = null;
  replaceTrack(next: MediaStreamTrack | null) {
    replaced.push(next);
    this.track = next;
    return Promise.resolve();
  }
}

class FakePeer {
  connectionState = "new";
  onconnectionstatechange: (() => void) | null = null;
  closed = false;
  sender = new FakeSender();

  createDataChannel() {
    channel = { onmessage: null };
    return channel;
  }
  addTrack(track: MediaStreamTrack) {
    addedTracks.push(track);
    this.sender.track = track;
    return this.sender;
  }
  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "v=0 offer" });
  }
  setLocalDescription() {
    return Promise.resolve();
  }
  setRemoteDescription() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
  }
  /** Drive the state the browser would report. */
  settle(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

/** The recorder's track. `enabled` must still be true when the monitor is done. */
function microphone() {
  const track = {
    kind: "audio",
    enabled: true,
    stopped: false,
    clone() {
      const copy = {
        kind: "audio",
        enabled: true,
        stop() {
          clonesStopped += 1;
        },
      };
      return copy as unknown as MediaStreamTrack;
    },
    stop() {
      track.stopped = true;
    },
  };
  return track;
}

function streamWith(track: ReturnType<typeof microphone>) {
  return { getAudioTracks: () => [track] } as unknown as MediaStream;
}

const emit = (payload: object) => channel.onmessage?.({ data: JSON.stringify(payload) });

beforeEach(() => {
  addedTracks = [];
  replaced = [];
  clonesStopped = 0;
  connection = new FakePeer();

  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      constructor() {
        return connection;
      }
    },
  );
  handshakeUrl = "";
  recordedMs = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.startsWith("/api/realtime-token")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ value: "ek_test", model: "gpt-live-transcribe" }),
        });
      }
      handshakeUrl = url;
      return Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve("v=0 answer") });
    }),
  );
});

test("the handshake sends no model parameter", async () => {
  // The session - type, transcription model, prompt, keywords - is bound to the
  // minted token. That query slot names a realtime *conversational* model, so a
  // transcription model there is refused: 'not supported in transcription mode'.
  const stream = streamWith(microphone());
  renderHook(() => useLiveTranscript(stream, false, clock, 0));

  await waitFor(() => expect(handshakeUrl).toBeTruthy());
  expect(handshakeUrl).toBe("https://api.openai.com/v1/realtime/calls");
  expect(handshakeUrl).not.toContain("model");
});

test("a refused handshake reports the upstream reason, not just the status", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url.startsWith("/api/realtime-token")
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ value: "ek_test" }) })
        : Promise.resolve({
            ok: false,
            status: 400,
            text: () =>
              Promise.resolve(
                JSON.stringify({ error: { message: 'Model "x" is not supported in transcription mode.' } }),
              ),
          }),
    ),
  );
  const stream = streamWith(microphone());
  const { result } = renderHook(() => useLiveTranscript(stream, false, clock, 0));

  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.error).toContain("not supported in transcription mode");
});

test("deltas accumulate as a partial, then commit as an utterance", async () => {
  const stream = streamWith(microphone());
  const { result } = renderHook(() => useLiveTranscript(stream, false, clock, 0));

  await waitFor(() => expect(channel).toBeDefined());
  act(() => connection.settle("connected"));
  expect(result.current.status).toBe("live");

  recordedMs = 8_000; // the speaker starts here
  act(() => {
    emit({ type: "conversation.item.input_audio_transcription.delta", delta: "front length " });
    emit({ type: "conversation.item.input_audio_transcription.delta", delta: "twenty two" });
  });
  expect(result.current.partial).toBe("front length twenty two");
  expect(result.current.utterances).toEqual([]);

  recordedMs = 12_000; // and finishes here
  act(() =>
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "front length twenty two one eight, minus one by eight",
    }),
  );
  expect(result.current.partial).toBe("");
  // Stamped 8s, where the line began: that is the point a reviewer scrubs to
  // when checking this reading, not the moment the phrase happened to end.
  expect(result.current.utterances).toEqual([
    { at: 8_000, text: "front length twenty two one eight, minus one by eight" },
  ]);
});

test("the monitor clones the microphone and never disables the recorder's track", async () => {
  const track = microphone();
  const stream = streamWith(track);
  const { unmount } = renderHook(() => useLiveTranscript(stream, false, clock, 0));

  await waitFor(() => expect(addedTracks).toHaveLength(1));
  expect(addedTracks[0]).not.toBe(track); // a clone, not the recorder's own

  unmount();
  // The recording's track is left exactly as the recorder left it.
  expect(track.enabled).toBe(true);
  expect(track.stopped).toBe(false);
  expect(clonesStopped).toBe(1);
  expect(connection.closed).toBe(true);
});

test("pausing stops sending audio and keeps the transcript so far", async () => {
  const stream = streamWith(microphone());
  const { result, rerender } = renderHook(
    ({ paused }: { paused: boolean }) => useLiveTranscript(stream, paused, clock, 0),
    { initialProps: { paused: false } },
  );

  await waitFor(() => expect(channel).toBeDefined());
  act(() => connection.settle("connected"));
  act(() =>
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "size large",
    }),
  );

  rerender({ paused: true });
  await waitFor(() => expect(replaced.at(-1)).toBeNull());
  expect(result.current.utterances.map((u) => u.text)).toEqual(["size large"]); // not discarded

  rerender({ paused: false });
  await waitFor(() => expect(replaced.at(-1)).not.toBeNull());
  expect(result.current.status).toBe("live");
});

test("a lost connection says so rather than looking like silence", async () => {
  const stream = streamWith(microphone());
  const { result } = renderHook(() => useLiveTranscript(stream, false, clock, 0));

  await waitFor(() => expect(channel).toBeDefined());
  act(() => connection.settle("connected"));
  act(() => connection.settle("failed"));

  expect(result.current.status).toBe("error");
  expect(result.current.error).toMatch(/recording is unaffected/);
});

test("a refused token reports the server's reason and does not throw", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ detail: "live transcription is off" }),
      }),
    ),
  );
  const stream = streamWith(microphone());
  const { result } = renderHook(() => useLiveTranscript(stream, false, clock, 0));

  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.error).toBe("live transcription is off");
});

test("no stream means the monitor stays off", () => {
  const { result } = renderHook(() => useLiveTranscript(null, false, clock, 0));

  expect(result.current.status).toBe("off");
  expect(result.current.utterances).toEqual([]);
});

test("a new recording starts from a blank transcript", async () => {
  const first = streamWith(microphone());
  const { result, rerender } = renderHook(
    ({ stream }: { stream: MediaStream }) => useLiveTranscript(stream, false, clock, 0),
    { initialProps: { stream: first } },
  );

  await waitFor(() => expect(channel).toBeDefined());
  act(() => connection.settle("connected"));
  act(() =>
    emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "old take" }),
  );
  expect(result.current.utterances.map((u) => u.text)).toEqual(["old take"]);

  connection = new FakePeer();
  rerender({ stream: streamWith(microphone()) });
  // Derived from the stream identity, so the previous take's text is gone
  // immediately rather than one render later.
  expect(result.current.utterances).toEqual([]);
});

test("the saved transcript is one timestamped line per utterance", () => {
  // The shape that lands in data/transcripts/<name>.live.txt. One line per
  // utterance, stamped, so a reviewer chasing an unanswered point of measure
  // can scrub straight to it instead of hunting through half an hour of audio.
  const saved = transcriptText([
    { at: 4_000, text: "size double extra small" },
    { at: 11_500, text: "front length twenty two one eight, minus one by eight" },
    { at: 3_725_000, text: "okay" },
  ]);

  expect(saved.split("\n")).toEqual([
    "[0:04] size double extra small",
    "[0:11] front length twenty two one eight, minus one by eight",
    "[1:02:05] okay",
  ]);
});

test("an empty transcript saves as nothing at all", () => {
  expect(transcriptText([])).toBe("");
});

test("speech resuming after a pause starts a new line", async () => {
  // The whole point of the change. gpt-live-transcribe streams one unbroken
  // caption - measured: 44 deltas, 0 completion events - so the break has to be
  // made here, off the recorder's own level meter.
  const stream = streamWith(microphone());
  const { result, rerender } = renderHook(
    ({ pauses }: { pauses: number }) => useLiveTranscript(stream, false, clock, pauses),
    { initialProps: { pauses: 0 } },
  );

  await waitFor(() => expect(channel).toBeDefined());
  act(() => connection.settle("connected"));

  recordedMs = 4_000;
  act(() => emit({ type: "x.input_audio_transcription.delta", delta: "size large" }));
  expect(result.current.partial).toBe("size large");
  expect(result.current.utterances).toEqual([]);

  // The speaker stops, then starts again: the recorder counts the pause...
  rerender({ pauses: 1 });
  recordedMs = 11_000;
  // ...and the first word after it closes the previous line.
  act(() => emit({ type: "x.input_audio_transcription.delta", delta: "front length" }));

  expect(result.current.utterances).toEqual([{ at: 4_000, text: "size large" }]);
  expect(result.current.partial).toBe("front length");
});

test("a line is stamped from its first word, not its last", async () => {
  const stream = streamWith(microphone());
  const { result, rerender } = renderHook(
    ({ pauses }: { pauses: number }) => useLiveTranscript(stream, false, clock, pauses),
    { initialProps: { pauses: 0 } },
  );

  await waitFor(() => expect(channel).toBeDefined());
  act(() => connection.settle("connected"));

  recordedMs = 30_000;
  act(() => emit({ type: "x.input_audio_transcription.delta", delta: "front length " }));
  recordedMs = 34_000; // still the same breath, four seconds later
  act(() => emit({ type: "x.input_audio_transcription.delta", delta: "twenty two one eight" }));
  rerender({ pauses: 1 });
  recordedMs = 40_000;
  act(() => emit({ type: "x.input_audio_transcription.delta", delta: "okay" }));

  // 30s, where the speaker began - that is what a reviewer scrubs back to.
  expect(result.current.utterances[0]).toEqual({
    at: 30_000,
    text: "front length twenty two one eight",
  });
});

test("without a pause everything stays on one line", async () => {
  const stream = streamWith(microphone());
  const { result } = renderHook(() => useLiveTranscript(stream, false, clock, 0));

  await waitFor(() => expect(channel).toBeDefined());
  act(() => connection.settle("connected"));
  act(() => {
    emit({ type: "x.input_audio_transcription.delta", delta: "one " });
    emit({ type: "x.input_audio_transcription.delta", delta: "continuous " });
    emit({ type: "x.input_audio_transcription.delta", delta: "reading" });
  });

  expect(result.current.utterances).toEqual([]);
  expect(result.current.partial).toBe("one continuous reading");
});

test("the line still open is included in what gets saved", async () => {
  // Pressing Done mid-sentence must not lose the last thing said.
  const stream = streamWith(microphone());
  const { result, rerender } = renderHook(
    ({ pauses }: { pauses: number }) => useLiveTranscript(stream, false, clock, pauses),
    { initialProps: { pauses: 0 } },
  );

  await waitFor(() => expect(channel).toBeDefined());
  act(() => connection.settle("connected"));
  recordedMs = 2_000;
  act(() => emit({ type: "x.input_audio_transcription.delta", delta: "first line" }));
  rerender({ pauses: 1 });
  recordedMs = 9_000;
  act(() => emit({ type: "x.input_audio_transcription.delta", delta: "still talking" }));

  expect(result.current.utterances).toHaveLength(1);
  expect(result.current.lines).toEqual([
    { at: 2_000, text: "first line" },
    { at: 9_000, text: "still talking" },
  ]);
});
