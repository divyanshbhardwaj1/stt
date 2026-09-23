import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { LiveTranscript } from "./LiveTranscript";

// Explicit, because vitest runs with globals: false, so testing-library cannot
// register its own afterEach and renders would otherwise pile up in one DOM.
afterEach(cleanup);

/**
 * The feed's job is to be readable at a glance while someone is still talking:
 * one line per utterance, in order, with the in-flight words distinguishable
 * from the settled ones.
 */

const SPOKEN = [
  { at: 4_000, text: "size double extra small" },
  { at: 11_500, text: "front length twenty two one eight, minus one by eight" },
];

test("each utterance is its own line, in the order it was said", () => {
  render(
    <LiveTranscript status="live" error="" utterances={SPOKEN} partial="" live={true} />,
  );

  const lines = screen.getAllByRole("listitem");
  expect(lines).toHaveLength(2);
  expect(lines[0].textContent).toContain("size double extra small");
  expect(lines[1].textContent).toContain("minus one by eight");
});

test("every line carries where it sits in the recording", () => {
  render(
    <LiveTranscript status="live" error="" utterances={SPOKEN} partial="" live={true} />,
  );

  // Scrubbing back to an unanswered point of measure is the whole workflow.
  expect(screen.getByText("0:04")).toBeDefined();
  expect(screen.getByText("0:11")).toBeDefined();
});

test("the words still being spoken are a separate, marked line", () => {
  render(
    <LiveTranscript
      status="live"
      error=""
      utterances={SPOKEN}
      partial="across front seam to"
      live={true}
    />,
  );

  const lines = screen.getAllByRole("listitem");
  expect(lines).toHaveLength(3);
  // Marked, so a half-heard phrase is not mistaken for a settled reading.
  expect(lines[2].className).toContain("partial");
  expect(lines[2].textContent).toContain("across front seam to");
});

test("it says it is a monitor, not the report", () => {
  render(<LiveTranscript status="live" error="" utterances={SPOKEN} partial="" live={true} />);

  expect(screen.getByText(/transcribed again afterwards/)).toBeDefined();
});

test("a finished take shows its transcript without claiming to be listening", () => {
  render(<LiveTranscript status="off" error="" utterances={SPOKEN} partial="" live={false} />);

  expect(screen.getByText("Heard while recording")).toBeDefined();
  expect(screen.queryByText("Listening")).toBeNull();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});

test("waiting for speech explains itself rather than sitting blank", () => {
  render(<LiveTranscript status="live" error="" utterances={[]} partial="" live={true} />);

  expect(screen.getByText(/Read a point of measure aloud/)).toBeDefined();
});

test("a failure says the recording is still fine", () => {
  render(
    <LiveTranscript
      status="error"
      error="live transcription is off"
      utterances={[]}
      partial=""
      live={true}
    />,
  );

  expect(screen.getByText(/live transcription is off/)).toBeDefined();
  expect(screen.getByText(/recording itself is unaffected/)).toBeDefined();
});

test("text already heard survives a connection lost mid-recording", () => {
  render(
    <LiveTranscript status="error" error="connection lost" utterances={SPOKEN} partial="" live={true} />,
  );

  // Throwing away what was already transcribed would be the worse failure.
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});
