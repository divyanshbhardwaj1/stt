import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useRecorder, type Take } from "./useRecorder";

/**
 * The recorder transport, and specifically its timing.
 *
 * A paused stretch must count towards neither the clock nor the recorded
 * duration, and a discarded take must leave nothing behind. Both are easy to
 * get subtly wrong and impossible to notice by eye, because the audio itself
 * is still correct — only the reported length is off.
 */

let stoppedTracks = 0;
let closedContexts = 0;

class FakeRecorder {
  static isTypeSupported = (type: string) => type === "audio/webm";
  static last: FakeRecorder | null = null;

  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio bytes"]) });
    this.onstop?.();
  }
}

class FakeAudioContext {
  state = "running";
  createAnalyser() {
    return {
      fftSize: 1024,
      smoothingTimeConstant: 0,
      connect: () => {},
      getByteTimeDomainData: (buffer: Uint8Array) => buffer.fill(168),
    };
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  close() {
    closedContexts += 1;
    return Promise.resolve();
  }
  resume() {}
}

beforeEach(() => {
  stoppedTracks = 0;
  closedContexts = 0;
  FakeRecorder.last = null;
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);

  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () =>
        Promise.resolve({ getTracks: () => [{ stop: () => (stoppedTracks += 1) }] }),
    },
  });
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

test("a paused stretch counts towards neither the clock nor the take", async () => {
  const takes: Take[] = [];
  const { result } = renderHook(() => useRecorder((take) => takes.push(take)));

  await act(async () => {
    await result.current.start();
  });
  expect(result.current.state).toBe("recording");

  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  expect(result.current.ms).toBe(10_000);

  act(() => result.current.pause());
  expect(result.current.state).toBe("paused");

  await act(async () => {
    vi.advanceTimersByTime(30_000);
  });
  expect(result.current.ms).toBe(10_000); // the pause is not recorded time

  act(() => result.current.resume());
  expect(result.current.state).toBe("recording");

  await act(async () => {
    vi.advanceTimersByTime(5_000);
  });
  expect(result.current.ms).toBe(15_000);

  act(() => result.current.finish());
  expect(result.current.state).toBe("idle");
  expect(takes).toHaveLength(1);
  expect(takes[0].ms).toBe(15_000);
  expect(takes[0].file.name).toMatch(/^inspection-[\d-]+\.webm$/);
  expect(takes[0].file.size).toBeGreaterThan(0);
});

test("discard keeps nothing and still releases the microphone", async () => {
  const takes: Take[] = [];
  const { result } = renderHook(() => useRecorder((take) => takes.push(take)));

  await act(async () => {
    await result.current.start();
  });
  await act(async () => {
    vi.advanceTimersByTime(4_000);
  });
  act(() => result.current.discard());

  expect(result.current.state).toBe("idle");
  expect(takes).toHaveLength(0);
  expect(stoppedTracks).toBe(1);
  expect(closedContexts).toBe(1);
});

test("the microphone and audio context are released on a normal finish", async () => {
  const { result } = renderHook(() => useRecorder(() => {}));

  await act(async () => {
    await result.current.start();
  });
  act(() => result.current.finish());

  expect(stoppedTracks).toBe(1);
  expect(closedContexts).toBe(1);
});

test("transport calls on an idle recorder are no-ops", async () => {
  const takes: Take[] = [];
  const { result } = renderHook(() => useRecorder((take) => takes.push(take)));

  act(() => result.current.pause());
  act(() => result.current.resume());
  act(() => result.current.finish());
  act(() => result.current.discard());

  expect(result.current.state).toBe("idle");
  expect(takes).toHaveLength(0);
});

test("a blocked microphone reports why and stays idle", async () => {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
    },
  });
  const { result } = renderHook(() => useRecorder(() => {}));

  await act(async () => {
    await result.current.start();
  });

  expect(result.current.state).toBe("idle");
  expect(result.current.error).toMatch(/Microphone blocked/);
});
