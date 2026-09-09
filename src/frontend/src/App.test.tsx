import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App";

afterEach(cleanup);

/**
 * The pane hand-off.
 *
 * The transcript has to occupy the work pane while recording - that is the only
 * place tall enough for it to run top to bottom - and hand the pane back to the
 * report once there is one. Getting this wrong is invisible in unit tests of
 * either component alone.
 */

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(url.startsWith("/api/style-sets") ? [] : []),
      }),
    ),
  );
  vi.stubGlobal("MediaRecorder", undefined);
});

test("with nothing recorded the pane holds the empty state", async () => {
  render(<App />);

  await waitFor(() => expect(screen.getByText("No inspection selected")).toBeDefined());
  // And the recorder is still the first thing offered, above it.
  expect(screen.getByRole("button", { name: /Record inspection|Recording unavailable/ })).toBeDefined();
});

test("the empty state points at the recorder above it", async () => {
  render(<App />);

  // Scoped to the pane: the sidebar's own empty list says something similar.
  await waitFor(() => expect(screen.getByText(/Reports land in/)).toBeDefined());
  expect(screen.getByText(/above to capture one now/)).toBeDefined();
});
