import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuditSheet } from "./AuditSheet";
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

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(SHEET) })),
  );
});

const cell = async () => {
  render(<AuditSheet job={JOB} onClose={() => {}} onSettled={() => {}} />);
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
