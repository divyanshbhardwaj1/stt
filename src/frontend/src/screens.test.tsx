import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App";
import type { Job } from "./types";

afterEach(cleanup);

/**
 * Every screen, for more than one role.
 *
 * Not a substitute for looking at it — this cannot tell you the rail is the
 * wrong shade of cream. What it catches is the class of failure that is
 * invisible until somebody clicks: a screen that throws on an empty list, a
 * capability read off an account that does not have it, a route that renders
 * nothing at all.
 */

const ADMIN = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  email: "tester@example.com",
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

const INSPECTOR = {
  ...ADMIN,
  name: "R. Menon",
  id: "0b5ed7f4-8a2c-4b91-9a5e-2f7d1c3e4a6b",
  email: "r.menon@triburg.com",
  admin: false,
  role: "inspector",
  role_label: "Inspector",
  stages: ["sizeset"],
  can: ["record", "audit.view"],
  roles: { sizeset: "inspector" },
};

const JOB: Job = {
  id: "abc123",
  filename: "Recording_20.m4a",
  style_no: "7270",
  status: "done",
  message: "12 rows, 1 needs review",
  name: "Recording_20",
  rows: 12,
  flagged: 1,
  sizes: ["S", "M"],
  error: "",
  downloads: ["report", "data"],
  form: { style_no: "7270" },
  accessories: 0,
  comments: 0,
  flagged_rows: [],
  graded: true,
  graded_style_no: "7270",
  announced_style_no: "7270",
  measurement_result: "FAIL CONDITIONALLY",
  judged: 10,
  out_of_tolerance: 2,
  unconfirmed: 1,
  unconfirmed_rows: [],
  failed_rows: [],
  elapsed: 42.5,
};

const ROSTER = {
  users: [
    {
      id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      email: "tester@example.com",
      name: "Test Administrator",
      admin: true,
      state: "active",
      roles: {},
      stages: ["sizeset", "ppm", "interim", "final"],
      created_at: "2026-09-23T10:00:00+00:00",
      last_seen_at: "2026-09-23T10:00:00+00:00",
    },
    {
      id: "0b5ed7f4-8a2c-4b91-9a5e-2f7d1c3e4a6b",
      email: "r.menon@triburg.com",
      name: "R. Menon",
      admin: false,
      state: "invited",
      roles: { sizeset: "inspector" },
      stages: ["sizeset"],
      created_at: "2026-09-23T10:00:00+00:00",
      last_seen_at: null,
    },
  ],
  stages: ["sizeset", "ppm", "interim", "final"],
  roles: [
    { id: "inspector", label: "Inspector", can: ["record", "audit.view"] },
    { id: "reviewer", label: "QA reviewer", can: ["record", "audit.view", "audit.edit"] },
    { id: "approver", label: "Approver", can: ["audit.view", "release"] },
    { id: "admin", label: "Administrator", can: ["record"] },
  ],
  capabilities: [{ id: "record", label: "Record and upload inspections" }],
};

function serve(me: object, jobs: Job[] = [JOB]) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      // Order matters and it is not obvious: "/api/me" is a prefix of nothing
      // else now, but the roster is still matched first out of habit.
      const answer =
        url.startsWith("/api/users") ? ROSTER
        : url.startsWith("/api/me") ? me
        : url.startsWith("/api/jobs") ? jobs
        : url.startsWith("/api/style-sets") ? ["7270", "2463"]
        : [];
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) });
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", undefined);
  window.location.hash = "";
  serve(ADMIN);
});

test("the register lists inspections and their state", async () => {
  window.location.hash = "#/inspections";
  render(<App />);

  await waitFor(() => expect(screen.getAllByText("Recording_20.m4a").length).toBeGreaterThan(0));
  // The prototype's state vocabulary, picked from the job: this one is done
  // with an open question, so it needs review.
  expect(screen.getAllByText("Needs review").length).toBeGreaterThan(0);
  // Tabs are built from what is present, so a state nobody is in gets none.
  expect(screen.queryByRole("button", { name: "Failed" })).toBeNull();
});

test("an inspection route resolves to its report", async () => {
  window.location.hash = "#/inspection/abc123";
  render(<App />);

  // report.html is not ported yet. This pins that the route resolves to the
  // report rather than to "not here", which is the part App owns.
  await waitFor(() => expect(screen.getAllByText(/Recording_20/).length).toBeGreaterThan(0));
  expect(screen.queryByText("That inspection is not here")).toBeNull();
});

test("an inspection id nobody has says so instead of rendering nothing", async () => {
  window.location.hash = "#/inspection/never-existed";
  render(<App />);

  await waitFor(() => expect(screen.getByText("That inspection is not here")).toBeDefined());
});

test("the style set library lists the sheets on disk", async () => {
  window.location.hash = "#/styles";
  render(<App />);

  await waitFor(() => expect(screen.getByText("7270")).toBeDefined());
  expect(screen.getByText("2463")).toBeDefined();
  // The prototype has an Upload button. There is no endpoint behind one, so
  // it is present and dead rather than absent, with the reason on it.
  const upload = screen.getByRole("button", { name: /Upload a sheet/i });
  expect(upload).toHaveProperty("disabled", true);
});

test("the stages screen shows the role held on each", async () => {
  window.location.hash = "#/stages";
  render(<App />);

  await waitFor(() => expect(screen.getAllByText("Size set").length).toBeGreaterThan(0));
  expect(screen.getAllByText("Final").length).toBeGreaterThan(0);
  // Only size set has a pipeline; the rest say so rather than pretending.
  expect(screen.getAllByText("Not built").length).toBeGreaterThan(0);
});

test("an inspector sees no access on the stages they do not hold", async () => {
  serve(INSPECTOR);
  window.location.hash = "#/stages";
  render(<App />);

  await waitFor(() => expect(screen.getAllByText("Size set").length).toBeGreaterThan(0));
  // Three stages they hold no role on, each card saying who to ask.
  expect(screen.getAllByText(/not on this stage/).length).toBe(3);
  expect(screen.getAllByText("Inspector").length).toBeGreaterThan(0);
});

test("the roster lists users with their roles and state", async () => {
  window.location.hash = "#/users";
  render(<App />);

  await waitFor(() => expect(screen.getAllByText("R. Menon").length).toBeGreaterThan(0));
  // The prototype's teamchip: the stage tile, its name, then the role.
  expect(screen.getByText("Administrator")).toBeDefined();
  expect(screen.getByText("invited")).toBeDefined();
  expect(screen.getAllByText("Inspector").length).toBeGreaterThan(0);
  // Recognised by address, addressed by uuid.
  expect(screen.getAllByText(/r.menon@triburg.com/).length).toBeGreaterThan(0);
});

test("the account screen shows your role on every stage", async () => {
  serve(INSPECTOR);
  window.location.hash = "#/account";
  render(<App />);

  await waitFor(() => expect(screen.getByText(/Signed in as/)).toBeDefined());
  // Every stage is listed, with a role or "no role": a stage that exists in
  // the permission model but nowhere on screen is how somebody concludes
  // their access is broken.
  expect(screen.getAllByText("no role").length).toBe(3);
  expect(screen.getAllByText("Inspector").length).toBeGreaterThan(0);
  expect(screen.getByText(/roles are not yours to change/)).toBeDefined();
});

test("every screen renders for an inspector without throwing", async () => {
  for (const hash of ["", "#/record", "#/styles", "#/stages", "#/account"]) {
    cleanup();
    serve(INSPECTOR);
    window.location.hash = hash;
    render(<App />);
    // The rail is the one thing on every screen; if the route threw, it is gone.
    await waitFor(() => expect(screen.getByRole("link", { name: "Style sets" })).toBeDefined());
  }
});
