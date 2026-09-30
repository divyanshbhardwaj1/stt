import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuditSheet } from "./AuditSheet";
import { SessionProvider } from "../SessionProvider";
import type { GradedSheet, Job } from "../types";

afterEach(cleanup);

/**
 * What a cell in the graded grid says.
 *
 * The rule this pins: a cell shows the style set's SPEC and the deviation
 * called against it — the same two facts, in the same order, that
 * graded_report.py prints into the PDF. It must not show the computed
 * measurement, which is spec + deviation and therefore identical to the spec on
 * every row the inspector passed. Two numbers a cell apart that agree on most
 * rows read as two rival readings of the garment, which is the one thing this
 * screen must never suggest.
 */

// 4.04A at size S, taken from a real extraction: spec 28 3/4, the inspector
// called -1/2, so the measurement works out at 28 1/4.
const SHEET: GradedSheet = {
  style_no: "2463",
  sizes: ["S"],
  base_size: "S",
  measured_sizes: ["S"],
  verdict: "PASS",
  disputed: 0,
  low_confidence: 0,
  below_full: 0,
  review_threshold: 0.85,
  size_check: [],
  unmatched: [],
  corrections: [],
  rows: [
    {
      kind: "pom",
      pom: "4.04A",
      description: "WAIST RELAXED @ TOP EDGE",
      sheet_index: 0,
      tol_minus: "-3/4",
      tol_plus: "+3/4",
      measured_here: true,
      cells: {
        S: {
          row: 12,
          spec: "28 3/4",
          measured: "28 1/4",
          deviation: "-1/2",
          state: "pass",
          confidence: 1,
          stated: { value: "28 3/4", deviation: "-1/2", verdict: "deviation", note: "" },
        },
      },
    },
  ],
};

const JOB = { id: "j1", graded_style_no: "2463", unconfirmed: 0, out_of_tolerance: 0 } as Job;

const CUES = { duration: 600, cues: { "12": { start: 120, end: 134, exact: true } } };

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

const ME = {
  id: "tester",
  name: "Test Administrator",
  admin: true,
  state: "active",
  stage: "sizeset",
  role: "admin",
  role_label: "Administrator",
  stages: ["sizeset", "ppm", "interim", "final"],
  can: [
    "record",
    "audit.view",
    "audit.edit",
    "download.working",
    "download.vendor",
    "release",
    "manage.styles",
    "manage.people",
  ],
  roles: { sizeset: "admin" },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            url.includes("/api/me") ? ME : url.includes("/cues") ? CUES : SHEET,
          ),
      }),
    ),
  );
  // jsdom implements no media pipeline, so the transport is stubbed and the
  // element is told it knows its own timeline - which is what lets a seek land.
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  const media = window.HTMLMediaElement.prototype;
  vi.spyOn(media, "play").mockImplementation(play as never);
  vi.spyOn(media, "pause").mockImplementation(pause as never);
  let at = 0;
  Object.defineProperty(media, "readyState", { configurable: true, get: () => 1 });
  Object.defineProperty(media, "currentTime", {
    configurable: true,
    get: () => at,
    set: (value: number) => {
      at = value;
    },
  });
});

const cell = async () => {
  render(
    <SessionProvider>
      <AuditSheet job={JOB} onClose={() => {}} onSettled={() => {}} />
    </SessionProvider>,
  );
  await waitFor(() => expect(screen.getByText("WAIST RELAXED @ TOP EDGE")).toBeDefined());
  return within(document.querySelector("td.cell") as HTMLElement);
};

test("a cell leads with the spec off the style set, as the PDF does", async () => {
  const found = await cell();
  expect(found.getByText("28 3/4")).toBeDefined();
});

test("a cell never shows the computed measurement beside the spec", async () => {
  const found = await cell();
  // 28 1/4 is spec + deviation. It belongs in the editor, not in the grid.
  expect(found.queryByText("28 1/4")).toBeNull();
});

test("the deviation the inspector called is shown against it", async () => {
  const found = await cell();
  expect(found.getByText("-1/2")).toBeDefined();
});


const playFirstReading = async () => {
  render(
    <SessionProvider>
      <AuditSheet job={JOB} onClose={() => {}} onSettled={() => {}} />
    </SessionProvider>,
  );
  await waitFor(() => expect(screen.getByText("WAIST RELAXED @ TOP EDGE")).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: /4\.04A S/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Play this reading/ }));
  await waitFor(() => expect(play).toHaveBeenCalled());
};

test("cancelling the editor stops the audio", async () => {
  await playFirstReading();

  pause.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(pause).toHaveBeenCalled();
});

test("staging a change stops the audio too", async () => {
  // Cancel is only one way out of the editor. A cue still running afterwards
  // talks over whatever cell the reviewer opens next.
  await playFirstReading();

  pause.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Stage this correction" }));

  expect(pause).toHaveBeenCalled();
});

/**
 * A cell settled by hand keeps no confidence colour.
 *
 * `settle()` rewrites the extraction row in place and leaves `confidence`
 * alone — it only sets 1.0 on a cell the recording never produced. So an edited
 * reading carries the transcription's certainty about speech that is no longer
 * in the cell, and the blue tint and the percentage never clear no matter how
 * many times a human corrects it.
 *
 * The verdict fill is the other half of the rule and must survive: `fail` is
 * recomputed from the operator's own deviation, and it still blocks release.
 */
test("a cell settled by hand drops the confidence tint but keeps its verdict", async () => {
  const edited: GradedSheet = {
    ...SHEET,
    rows: [
      {
        ...SHEET.rows[0],
        cells: {
          S: {
            ...SHEET.rows[0].cells!.S,
            state: "fail",
            confidence: 0.62,
            below_full: true,
            low_confidence: true,
            edited: true,
            edited_by: "Priya Nair",
            edited_at: "2026-09-28T11:30:00+00:00",
          },
        },
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(url.includes("/api/me") ? ME : url.includes("/cues") ? CUES : edited),
      }),
    ),
  );
  render(
    <SessionProvider>
      <AuditSheet job={JOB} onClose={() => {}} onSettled={() => {}} />
    </SessionProvider>,
  );
  await waitFor(() => expect(screen.getByText("WAIST RELAXED @ TOP EDGE")).toBeDefined());
  const td = document.querySelector("td.cell") as HTMLElement;

  expect(td.classList.contains("conf-mid")).toBe(false);
  expect(td.classList.contains("conf-low")).toBe(false);
  expect(within(td).queryByText("62%")).toBeNull();
  // The slot does not go empty: it says where the reading came from instead.
  expect(within(td).getByText("✎ by hand")).toBeDefined();
  // Settled, and still out of tolerance. Both have to be legible at once.
  expect(td.classList.contains("settled")).toBe(true);
  expect(td.classList.contains("fail")).toBe(true);
});

test("the editor names whoever last settled the cell", async () => {
  const edited: GradedSheet = {
    ...SHEET,
    rows: [
      {
        ...SHEET.rows[0],
        cells: {
          S: {
            ...SHEET.rows[0].cells!.S,
            edited: true,
            edited_by: "Priya Nair",
            edited_at: "2026-09-28T11:30:00+00:00",
          },
        },
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(url.includes("/api/me") ? ME : url.includes("/cues") ? CUES : edited),
      }),
    ),
  );
  render(
    <SessionProvider>
      <AuditSheet job={JOB} onClose={() => {}} onSettled={() => {}} />
    </SessionProvider>,
  );
  await waitFor(() => expect(screen.getByText("WAIST RELAXED @ TOP EDGE")).toBeDefined());
  fireEvent.click(document.querySelector("td.cell button") as HTMLElement);
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByText("Settled by")).toBeDefined();
  expect(dialog.getByText(/Priya Nair/)).toBeDefined();
});

/**
 * "okay" and a deviation cannot both be true.
 *
 * `_judge()` decides on-spec from the deviation alone (`on_spec = not spoken`),
 * so a cell saved as okay with +1/4 still in the box comes back measured at
 * spec + 1/4 and the verdict is dropped without a word. The editor has to make
 * that state unreachable rather than let the two disagree on save.
 */
test("choosing okay clears the deviation and locks the field", async () => {
  render(
    <SessionProvider>
      <AuditSheet job={JOB} onClose={() => {}} onSettled={() => {}} />
    </SessionProvider>,
  );
  await waitFor(() => expect(screen.getByText("WAIST RELAXED @ TOP EDGE")).toBeDefined());
  fireEvent.click(document.querySelector("td.cell button") as HTMLElement);

  const deviation = screen.getByPlaceholderText("e.g. -1/8") as HTMLInputElement;
  expect(deviation.value).toBe("-1/2"); // prefilled from what was stated
  expect(deviation.disabled).toBe(false);

  fireEvent.change(screen.getByRole("combobox"), { target: { value: "okay" } });
  const locked = screen.getByPlaceholderText("—") as HTMLInputElement;
  expect(locked.value).toBe("");
  expect(locked.disabled).toBe(true);

  // And back: switching away hands the field over again.
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "deviation" } });
  expect((screen.getByPlaceholderText("e.g. -1/8") as HTMLInputElement).disabled).toBe(false);
});
