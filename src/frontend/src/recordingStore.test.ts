import { describe, expect, it } from "vitest";
import { assembleChunks, pendingSessions, startSession } from "./recordingStore";

/**
 * Rebuilding a recording out of the chunks MediaRecorder handed us.
 *
 * The storage plumbing is thin; this is the part where a bug is silent. Only
 * chunk 0 carries the container header, so a set that is reordered or missing
 * its first chunk produces a file that looks like a recording and will not
 * play - and by the time anyone finds out, the inspection is unrepeatable.
 */

const MIME = "audio/webm";

/** A chunk whose bytes say which one it is, so order is checkable after joining. */
const chunk = (seq: number, body: string) => ({ seq, blob: new Blob([body], { type: MIME }) });

async function textOf(file: File): Promise<string> {
  return new Blob([file]).text();
}

describe("assembleChunks", () => {
  it("joins chunks in recorded order", async () => {
    const file = assembleChunks(
      [chunk(0, "HEADER"), chunk(1, "one"), chunk(2, "two")],
      "inspection.webm",
      MIME,
    );

    expect(file).not.toBeNull();
    expect(await textOf(file!)).toBe("HEADERonetwo");
    expect(file!.name).toBe("inspection.webm");
    expect(file!.type).toBe(MIME);
  });

  it("puts chunks back in order when storage hands them over shuffled", async () => {
    // Order is the whole correctness story: concatenated out of sequence the
    // clusters are garbage, and nothing downstream would say so.
    const file = assembleChunks(
      [chunk(2, "two"), chunk(0, "HEADER"), chunk(1, "one")],
      "inspection.webm",
      MIME,
    );

    expect(await textOf(file!)).toBe("HEADERonetwo");
  });

  it("refuses a set with no opening chunk", () => {
    // No chunk 0 means no EBML header, so there is no file here to recover -
    // and handing back a playable-looking one is worse than saying so.
    expect(assembleChunks([chunk(1, "one"), chunk(2, "two")], "inspection.webm", MIME)).toBeNull();
  });

  it("refuses an empty set", () => {
    expect(assembleChunks([], "inspection.webm", MIME)).toBeNull();
  });

  it("still rebuilds across an interior gap", async () => {
    // One failed write costs a second of audio. The rest of the inspection is
    // still worth having, and the intake makes the operator play it back.
    const file = assembleChunks([chunk(0, "HEADER"), chunk(2, "two")], "inspection.webm", MIME);

    expect(await textOf(file!)).toBe("HEADERtwo");
  });

  it("is quiet where the browser has no IndexedDB at all", async () => {
    // jsdom provides none, which is also what private browsing and blocked
    // site data look like from in here. Storage is insurance around the
    // recording, so its absence must cost the insurance and nothing else -
    // every call resolves, none of them throws, and capture carries on.
    await expect(
      startSession({
        id: "x",
        filename: "inspection.webm",
        mimeType: MIME,
        startedAt: 0,
        ms: 0,
        status: "recording",
        liveTranscript: "",
      }),
    ).resolves.toBeUndefined();
    await expect(pendingSessions()).resolves.toEqual([]);
  });

  it("keeps the container the recorder actually used", async () => {
    // Safari records audio/mp4 and the rest record audio/webm. The stored mime
    // type follows the recording, so a recovered take cannot be relabelled into
    // a container the bytes are not.
    const file = assembleChunks([chunk(0, "ftyp")], "inspection.mp4", "audio/mp4");

    expect(file!.type).toBe("audio/mp4");
  });
});
