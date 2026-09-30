import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App";
import { Dashboard } from "./components/Dashboard";
import { SessionProvider } from "./SessionProvider";
import { Intake } from "./components/Intake";
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
  stage: "sizeset",
  status: "done",
  message: "12 rows, 1 needs review",
  name: "Recording_20",
  title: "",
  review: "",
  review_note: "",
  reviewed_at: null,
  reviewed_by: "",
  released_at: null,
  released_by: "",
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
  started_at: Date.now() / 1000 - 3600,
  recorded_by: "R. Menon",
  recorded_by_id: "0b5ed7f4-8a2c-4b91-9a5e-2f7d1c3e4a6b",
  location: "Unit 2, bench 4",
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
  // The real eight, because the member dialog draws a row per capability and
  // a fixture with one cannot tell a working list from an empty one.
  capabilities: [
    { id: "record", label: "Record and upload inspections" },
    { id: "audit.view", label: "Open the graded sheet" },
    { id: "audit.edit", label: "Correct readings and save" },
    { id: "download.working", label: "Download working files (CSV, JSON)" },
    { id: "download.vendor", label: "Download vendor documents (PDF)" },
    { id: "release", label: "Release a report to the vendor" },
    { id: "manage.styles", label: "Manage the style set library" },
    { id: "manage.people", label: "Manage people and roles" },
  ],
};

/** What `GET /api/jobs/<id>` returns, when a test wants it to differ. */
let DETAIL: Job | null = null;

function serve(me: object, jobs: Job[] = [JOB]) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      // Order matters and it is not obvious: "/api/me" is a prefix of nothing
      // else now, but the roster is still matched first out of habit.
      const answer =
        url.startsWith("/api/users") ? ROSTER
        : url.startsWith("/api/me") ? me
        // `/api/jobs/<id>` is a different answer from `/api/jobs`, and the
        // difference is the whole point: the list is a summary and the single
        // read is the one that carries the report's detail tables and labels.
        : /^\/api\/jobs\/[^/]+$/.test(url) ? (DETAIL ?? jobs[0])
        : url.startsWith("/api/jobs") ? jobs
        : url.startsWith("/api/alert-rules") ? RULES
        : url.startsWith("/api/alerts") ? ALERTS
        : url.startsWith("/api/activity") ? TRAIL
        // One sheet is a different answer from the library, exactly as
        // `/api/jobs/<id>` is from `/api/jobs`. Returning the list for both
        // handed the style screen an array and it read `sizes` off it.
        : /^\/api\/style-sets\/sheets\/[^/]+$/.test(url)
          ? { ...(LIBRARY.find((sheet) => url.endsWith(sheet.style_no)) ?? LIBRARY[0]), rows: [] }
        : url.startsWith("/api/style-sets/sheets") ? LIBRARY
        : url.startsWith("/api/style-sets") ? ["7270", "2463"]
        : [];
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) });
    }),
  );
}

/** The catalogue plus this floor's settings, as the page edits it. */
const RULES = {
  rules: [
    {
      key: "processing_failed",
      label: "Processing failed",
      blurb: "Nothing was written and nothing was sent anywhere.",
      severity: "act",
      unit: "hours",
      enabled: true,
      amount: null,
      ways: ["inapp", "email"],
      default_amount: null,
      default_ways: ["inapp", "email"],
    },
    {
      key: "unanswered_stale",
      label: "Readings with no verdict",
      blurb: "Heard, never ruled on.",
      severity: "act",
      unit: "hours",
      enabled: true,
      amount: 4,
      ways: ["inapp"],
      default_amount: 24,
      default_ways: ["inapp", "email"],
    },
  ],
  channels: [
    { id: "inapp", label: "In the app" },
    { id: "email", label: "Email" },
  ],
  email_ready: false,
};

/** One open alert, as `GET /api/alerts` returns it. */
const ALERTS = [
  {
    id: "al-1",
    rule: "unanswered_stale",
    severity: "act",
    stage: "sizeset",
    needs: "audit.edit",
    subject_id: "abc123",
    title: "rec_2463(21): 1 point of measure still has no verdict",
    detail: "Recorded over 24 hours ago on style 2463. These are not passes.",
    raised_at: "2026-09-27T09:12:00+00:00",
  },
];

/** The audit trail, as the server sends it. */
const TRAIL = [
  {
    id: "e1",
    at: "2026-09-24T09:12:00+00:00",
    user_id: "u1",
    actor: "Test Administrator",
    kind: "record",
    stage: "sizeset",
    what: "Recorded an inspection - rec_2463(17).mp3",
    subject: "rec_2463(21)",
  },
  {
    id: "e2",
    at: "2026-09-23T16:42:00+00:00",
    user_id: null,
    actor: "",
    kind: "correction",
    stage: "sizeset",
    what: "Settled 2 readings by hand",
    subject: "rec_2463(20)",
  },
];

/** Two sheets, as `GET /api/style-sets/sheets` returns them. */
const LIBRARY = [
  {
    style_no: "7270",
    document: "style_7270.pdf",
    readable: true,
    description: "RIBBED HENLEY, LONG SLEEVE",
    company: "AMERICAN EAGLE OUTFITTERS",
    season: "FALL-A 2026",
    division: "02 / 022",
    status: "FNL",
    base_size: "M",
    sizes: ["S", "M", "L"],
    poms: 71,
    tolerance_model: "WW TOP L20",
    from_scan: false,
    last_used: null,
  },
  {
    style_no: "2463",
    document: "style_2463.pdf",
    readable: true,
    description: "TIERED MIDI SKIRT",
    company: "AMERICAN EAGLE OUTFITTERS",
    season: "SPRING 2027",
    division: "02 / 019",
    status: "FNL",
    base_size: "M",
    sizes: ["S", "M"],
    poms: 43,
    tolerance_model: "WW BTM L20",
    from_scan: false,
    last_used: null,
  },
];

beforeEach(() => {
  DETAIL = null;
  vi.stubGlobal("MediaRecorder", undefined);
  window.location.hash = "";
  serve(ADMIN);
});

test("the register lists styles, not recordings", async () => {
  window.location.hash = "#/inspections";
  render(<App />);

  // A garment is inspected four times and what those four share is the style.
  // The register is led by it, with a column per check.
  await waitFor(() => expect(screen.getAllByText("7270").length).toBeGreaterThan(0));
  expect(screen.getByText("RIBBED HENLEY, LONG SLEEVE")).toBeDefined();
  for (const stage of ["Size set", "PPM", "Interim", "Final"]) {
    expect(screen.getAllByText(stage).length).toBeGreaterThan(0);
  }
  // The recording itself is one level down, not here.
  expect(screen.queryByText("Recording_20.m4a")).toBeNull();
});

test("the register says which check a style last had, and how it went", async () => {
  window.location.hash = "#/inspections";
  render(<App />);

  // Waited for, not sampled: the row is drawn off the library, and the
  // inspection behind this cell arrives on the job poll a tick later.
  const latest = await waitFor(() => {
    const row = screen.getByText("RIBBED HENLEY, LONG SLEEVE").closest("tr");
    const cell = row?.querySelector(".latest");
    if (!cell) throw new Error("no latest check yet");
    return cell;
  });
  // Scoped to the cell: "Size set" is a column heading too, and the state word
  // appears on every screen that lists this inspection.
  expect(latest.querySelector("b")?.textContent).toBe("Size set");
  expect(latest.querySelector(".pill")?.textContent).toBe("Needs review");
});

test("the register's latest check moves with the inspection", async () => {
  serve(ADMIN, [
    { ...JOB, unconfirmed: 0, review: "pass", released_at: Date.now() / 1000, released_by: "A. Kaur" },
  ]);
  window.location.hash = "#/inspections";
  render(<App />);

  // Same word the style screen and the report use — one `stateOf`, so the
  // register cannot describe a released report as anything else.
  await waitFor(() => {
    const row = screen.getByText("RIBBED HENLEY, LONG SLEEVE").closest("tr");
    expect(row?.querySelector(".latest .pill")?.textContent).toBe("Released");
  });
});

test("the register filters by where the work got to", async () => {
  serve(ADMIN, [
    // 7270 still has a gap; 2463 has gone to the vendor. Two states, so two
    // tabs beside All — a state nobody is in never gets a tab.
    { ...JOB, id: "open", unconfirmed: 1 },
    {
      ...JOB,
      id: "done",
      style_no: "2463",
      graded_style_no: "2463",
      announced_style_no: "2463",
      unconfirmed: 0,
      review: "pass",
      released_at: Date.now() / 1000,
    },
  ]);
  window.location.hash = "#/inspections";
  render(<App />);

  await waitFor(() => expect(screen.getByText("TIERED MIDI SKIRT")).toBeDefined());
  // Scoped to the tab strip: "Released" is also the word in a row's own cell.
  const tabs = document.querySelector(".tabs") as HTMLElement;
  fireEvent.click(within(tabs).getByText("Released"));

  await waitFor(() => expect(screen.queryByText("RIBBED HENLEY, LONG SLEEVE")).toBeNull());
  expect(screen.getByText("TIERED MIDI SKIRT")).toBeDefined();
  // The count says what is being looked at, not what exists.
  expect(screen.getByText("1 of 2")).toBeDefined();
});

test("a style opens all four checks, whether or not they are built", async () => {
  window.location.hash = "#/style/7270";
  render(<App />);

  // Size set: the inspection that actually happened, openable.
  await waitFor(() => expect(screen.getAllByText("Recording_20.m4a").length).toBeGreaterThan(0));
  expect(screen.getAllByText("Needs review").length).toBeGreaterThan(0);
  expect(screen.getAllByRole("link", { name: "Open report" }).length).toBeGreaterThan(0);

  // All four panels render. A stage drawn only when it holds something is a
  // stage somebody concludes does not exist.
  for (const stage of ["Size set", "PPM", "Interim", "Final"]) {
    expect(screen.getAllByText(stage).length).toBeGreaterThan(0);
  }
  // The three without a pipeline carry stand-in rows, in their own vocabulary
  // rather than as three copies of a size-set row.
  expect(screen.getByText("Pre-production meeting")).toBeDefined();
  expect(screen.getByText("Line audit — first 20%")).toBeDefined();
  expect(screen.getByText("Final random inspection")).toBeDefined();
  // The on-screen marking came off on request (demoStages.ts, rule 3). What
  // has to stay true is that a stand-in row opens nothing — there is no report
  // behind it, and a link to a fabricated one is the failure worth guarding.
  expect(
    screen.queryAllByRole("link", { name: "Open report" }).length,
  ).toBe(1);
});

/**
 * Who recorded a check, and where they stood.
 *
 * Both were already served and already on screen — set at 11.5px under the
 * inspection's own name, which is where a detail goes to be missed. On a stage
 * holding several checks of one style they are what tells them apart, so they
 * are columns.
 */
test("the stage list names the inspector and the location", async () => {
  window.location.hash = "#/style/7270";
  render(<App />);

  await waitFor(() => expect(screen.getAllByText("Recording_20.m4a").length).toBeGreaterThan(0));
  for (const header of ["Inspector", "Location"]) {
    expect(screen.getAllByText(header).length).toBeGreaterThan(0);
  }
  expect(screen.getAllByText("R. Menon").length).toBeGreaterThan(0);

  // A long address is clamped by CSS, so the cell carries the whole of it —
  // a truncated location that cannot be read in full is worse than none.
  const where = screen.getAllByText("Unit 2, bench 4")[0];
  expect(where.getAttribute("title")).toBe("Unit 2, bench 4");
});

test("an inspection nobody is recorded against says so rather than going blank", async () => {
  window.location.hash = "#/style/7270";
  render(<App />);
  await waitFor(() => expect(screen.getAllByText("Recording_20.m4a").length).toBeGreaterThan(0));

  // The stand-in rows carry their own names; what must never appear is an
  // empty cell, which reads as a column that failed to load rather than as a
  // fact about the record.
  const cells = Array.from(document.querySelectorAll("table.data tbody tr")).map((row) =>
    Array.from(row.querySelectorAll("td")).map((td) => td.textContent),
  );
  expect(cells.length).toBeGreaterThan(0);
  for (const row of cells) {
    expect(row[1]).toBeTruthy(); // inspector
    expect(row[2]).toBeTruthy(); // location
  }
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
  // Every column is read out of the sheet, not invented by the screen.
  expect(screen.getByText("RIBBED HENLEY, LONG SLEEVE")).toBeDefined();
  expect(screen.getByText("71")).toBeDefined();
  expect(screen.getAllByText("Ready").length).toBe(2);
  // Upload is live now, and opens the dialog that parses the PDF.
  const upload = screen.getByRole("button", { name: /Upload a sheet/i });
  expect(upload).toHaveProperty("disabled", false);
  fireEvent.click(upload);
  expect(screen.getByRole("dialog", { name: "Upload a sheet" })).toBeDefined();
  expect(screen.getByText("Drop a PDF here")).toBeDefined();
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


/** Put a file in front of the record screen, which is what reveals the options. */
async function recordScreenWithAFile(container: HTMLElement) {
  const file = new File(["x"], "take.mp3", { type: "audio/mpeg" });
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  // It lives inside the dropzone label. Loose on the page it renders as a
  // stray "No file chosen" control under everything else.
  expect(input.hidden).toBe(true);
  expect(container.querySelector('.dropzone')).not.toBeNull();
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText("Where")).toBeDefined());
}

/**
 * A library big enough that the picker has to be searched rather than scrolled.
 * `7270` and `7271` share a prefix on purpose — narrowing has to keep both.
 */
const STYLE_LIBRARY = ["2463", "7122", "7147", "7270", "7271", "9601", "9662"];

/** The style library, plus whatever the reverse geocoder is meant to say. */
function stubFetch(address?: Record<string, string>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes("nominatim")
          ? { ok: Boolean(address), json: () => Promise.resolve({ address }) }
          : { ok: true, json: () => Promise.resolve(STYLE_LIBRARY) },
      ),
    ),
  );
}

function stubFix(accuracy = 11.4) {
  vi.stubGlobal("navigator", {
    ...navigator,
    geolocation: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: 12.9716, longitude: 77.5946, accuracy } } as GeolocationPosition),
    },
  });
}

test("the browser's own answer fills in where, and the box goes away", async () => {
  stubFetch({
    road: "Residency Road",
    suburb: "Shanthala Nagar",
    city_district: "Shanthala Nagar", // Nominatim repeats itself; the UI must not
    city: "Bengaluru",
    state: "Karnataka",
    postcode: "560025",
  });
  stubFix();

  const { container } = render(<Intake onQueued={vi.fn()} />);
  await recordScreenWithAFile(container);

  // The address is what an inspector reads; the fix is the footnote under it.
  await waitFor(() =>
    expect(container.querySelector(".opts .pill")?.textContent).toBe(
      "Residency Road, Shanthala Nagar, Bengaluru, Karnataka, 560025",
    ),
  );
  expect(screen.getByText(/12.97160, 77.59460/)).toBeDefined();
  expect(screen.getByText(/to within 11 m/)).toBeDefined();
  // Typing is the fallback, so while the browser is answering there is nothing
  // to type into — only the offer to override it.
  expect(container.querySelector("#where")).toBeNull();
  expect(screen.getByText("type it instead")).toBeDefined();
});

test("no address service, no problem: the fix stands on its own", async () => {
  stubFetch(); // nominatim answers with an error
  stubFix();

  const { container } = render(<Intake onQueued={vi.fn()} />);
  await recordScreenWithAFile(container);

  expect(container.querySelector(".opts .pill")?.textContent).toBe("12.97160, 77.59460");
});

test("the style picker is searched, not scrolled", async () => {
  stubFetch();
  const { container } = render(<Intake onQueued={vi.fn()} />);
  await recordScreenWithAFile(container);

  const box = container.querySelector("#style") as HTMLInputElement;
  /** The style rows, without the "announced in the recording" row above them. */
  const options = () =>
    [...container.querySelectorAll('.stylepick-list li[role="option"]:not(.any)')].map(
      (row) => row.textContent,
    );

  // A combobox, not a <select>. At three to four thousand styles the operator
  // would be scrolling for a number they already know.
  expect(box.tagName).toBe("INPUT");
  expect(box.getAttribute("role")).toBe("combobox");
  expect(box.getAttribute("aria-expanded")).toBe("false");

  fireEvent.click(box);
  expect(box.getAttribute("aria-expanded")).toBe("true");
  await waitFor(() => expect(options()).toEqual(STYLE_LIBRARY));

  // Typing narrows it, and a shared prefix keeps every match.
  fireEvent.change(box, { target: { value: "72" } });
  expect(options()).toEqual(["7270", "7271"]);
  // The matched run is marked, so it is visible why a row is in the list
  // rather than leaving seven numbers that all start alike to be re-read.
  expect(container.querySelector(".stylepick-list mark")?.textContent).toBe("72");

  // Nothing matches is a state, not an empty panel.
  fireEvent.change(box, { target: { value: "8888" } });
  expect(options()).toEqual([]);
  expect(container.querySelector(".stylepick-list .note")?.textContent).toContain(
    "No sheet matches",
  );
});

test("the style picker is driven from the keyboard", async () => {
  stubFetch();
  const { container } = render(<Intake onQueued={vi.fn()} />);
  await recordScreenWithAFile(container);

  const box = container.querySelector("#style") as HTMLInputElement;
  fireEvent.change(box, { target: { value: "72" } });
  await waitFor(() =>
    expect(
      container.querySelectorAll('.stylepick-list li[role="option"]:not(.any)').length,
    ).toBe(2),
  );

  // A datalist gave this away for free; the panel is ours now, so this is the
  // part that has to be held down by a test rather than by the browser.
  fireEvent.keyDown(box, { key: "ArrowDown" });
  fireEvent.keyDown(box, { key: "Enter" });

  expect(box.value).toBe("7270");
  expect(screen.getByText(/Style 7270 . graded against its sheet/)).toBeDefined();
  // Choosing closes it.
  expect(container.querySelector(".stylepick-list")).toBeNull();

  // Escape closes without choosing.
  fireEvent.click(box);
  expect(container.querySelector(".stylepick-list")).not.toBeNull();
  fireEvent.keyDown(box, { key: "Escape" });
  expect(container.querySelector(".stylepick-list")).toBeNull();
  expect(box.value).toBe("7270");
});

test("the default is a row, not an empty field", async () => {
  stubFetch();
  const { container } = render(<Intake onQueued={vi.fn()} />);
  await recordScreenWithAFile(container);

  const box = container.querySelector("#style") as HTMLInputElement;
  fireEvent.change(box, { target: { value: "7271" } });
  await waitFor(() => expect(box.value).toBe("7271"));

  // "Use whatever the recording announces" is a real answer. A datalist can
  // only suggest values, so it could only ever live in a placeholder nobody
  // reads — and getting back to it meant deleting what you had typed.
  const any = container.querySelector(".stylepick-list li.any") as HTMLElement;
  expect(any.textContent).toContain("Style announced in the recording");
  fireEvent.click(any);

  expect(box.value).toBe("");
});

test("a style with no sheet blocks the upload rather than wasting it", async () => {
  stubFetch();
  const { container } = render(<Intake onQueued={vi.fn()} />);
  await recordScreenWithAFile(container);

  const box = container.querySelector("#style") as HTMLInputElement;
  await waitFor(() => expect(container.querySelector("#style")).not.toBeNull());

  fireEvent.change(box, { target: { value: "8888" } });

  // The server refuses an unknown style with a 404 — but only after the
  // recording has been uploaded and deleted again, which on a phone connection
  // is minutes thrown away for a typo. Said here instead.
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("No sheet for style 8888"),
  );
  expect(box.getAttribute("aria-invalid")).toBe("true");
  expect(
    (screen.getByRole("button", { name: "Process this recording" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);

  // Clearing it is a real answer, not a missing one: use whatever the
  // recording announces.
  fireEvent.change(box, { target: { value: "" } });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Process this recording" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

test("a denied prompt leaves the operator the box", async () => {
  stubFetch();
  vi.stubGlobal("navigator", {
    ...navigator,
    geolocation: {
      getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code: 1, message: "denied" } as GeolocationPositionError),
    },
  });

  const { container } = render(<Intake onQueued={vi.fn()} />);
  await recordScreenWithAFile(container);

  expect(container.querySelector("#where")).not.toBeNull();
});


test("the activity screen shows the trail, attributed", async () => {
  window.location.hash = "#/activity";
  render(<App />);

  await waitFor(() => expect(screen.getByText(/Recorded an inspection/)).toBeDefined());
  expect(screen.getAllByText("Test Administrator").length).toBeGreaterThan(0);
  expect(screen.getByText("Settled 2 readings by hand")).toBeDefined();
  // An event written before sign-in attribution existed says so rather than
  // being filled in with a guess.
  expect(screen.getAllByText("Unattributed").length).toBeGreaterThan(0);
});


test("the report's detail tables come from the single read, not the poll", async () => {
  // Exactly the shape a restarted server serves: the counts survive as
  // columns, the rows behind them do not, and only `GET /api/jobs/<id>`
  // rebuilds them. A report that shows "2 out of tolerance" over an empty
  // table reads as a bug in the grading rather than in the bookkeeping.
  DETAIL = {
    ...JOB,
    form: { style_no: "7270", yy_mini_marker: "Shell = 52.92 cm" },
    form_labels: { yy_mini_marker: "YY/ Mini Marker" },
    unconfirmed_rows: [
      {
        no: 22,
        size: "M",
        pom: "6.05B",
        description: "ON SEAM POCKET HEM HEIGHT",
        spec: "1/4",
        spoken: "",
      },
    ],
    failed_rows: [
      {
        no: 7,
        size: "S",
        pom: "1.22A",
        description: "CHEST 1 BELOW ARMHOLE",
        spec: "11 1/4",
        measured: "11",
        deviation: "-1/4",
      },
    ],
  } as Job;

  // The poll knows the field; it does not know what the client prints it as.
  serve(ADMIN, [{ ...JOB, form: { style_no: "7270", yy_mini_marker: "Shell = 52.92 cm" } }]);

  window.location.hash = "#/inspection/abc123";
  render(<App />);

  await waitFor(() => expect(screen.getByText("ON SEAM POCKET HEM HEIGHT")).toBeDefined());
  expect(screen.getByText("CHEST 1 BELOW ARMHOLE")).toBeDefined();
  // And the client's own printed label, which the list never sends either.
  expect(screen.getByText("YY/ Mini Marker")).toBeDefined();
});


test("the dashboard counts every inspection exactly once", async () => {
  const base = { ...JOB };
  serve(ADMIN, [
    // Finished and complete.
    { ...base, id: "a", unconfirmed: 0, out_of_tolerance: 0, measurement_result: "PASS" },
    // Finished, one point of measure still unanswered — pending, and old
    // enough to be overdue.
    {
      ...base,
      id: "b",
      unconfirmed: 1,
      out_of_tolerance: 0,
      measurement_result: "PASS PENDING 1 CHECK",
      started_at: Date.now() / 1000 - 3 * 86400,
    },
    // Finished and complete, but a measurement failed.
    {
      ...base,
      id: "c",
      unconfirmed: 0,
      out_of_tolerance: 2,
      measurement_result: "FAIL CONDITIONALLY",
    },
  ]);

  window.location.hash = "";
  render(<App />);

  // Scoped to the readout strip, not a global text search. Every one of these
  // labels is also a word in the paragraph underneath explaining it, so
  // `getByText("Overdue")` finds the `<dt>` and the `<b>` and refuses to
  // choose — which is what it was doing here before.
  const figure = (label: string) =>
    [...document.querySelectorAll("dl.readout > div")]
      .find((box) => box.querySelector("dt")?.textContent === label)
      ?.querySelector("dd")?.textContent;

  // The readout renders at zero before the first poll lands, so wait on the
  // value rather than on the label.
  await waitFor(() => expect(figure("Total inspections")).toBe("3"));
  expect(figure("Pending")).toBe("1");
  expect(figure("Done")).toBe("2");
  expect(figure("Overdue")).toBe("1");
  // b has an unanswered reading, c has a failed measurement. Counted once each.
  expect(figure("Need attention")).toBe("2");
  // One PASS out of three that carry a verdict.
  expect(figure("Pass %")).toBe("33%");

  // The fortnight chart is drawn entirely in CSS, so the markup IS the chart:
  // app.css colours `.bar .stack .good` and `.bar .stack .gap` and nothing
  // else. An earlier version emitted bare `<i>` elements, which matched no
  // rule and rendered fourteen invisible columns — a silent failure no
  // assertion about the counts could have caught.
  expect(document.querySelectorAll(".bars .bar").length).toBe(14);
  expect(document.querySelectorAll(".bars .bar .stack .good").length).toBe(14);
  expect(document.querySelectorAll(".bars .bar .stack .gap").length).toBe(14);

  // The newest lines of the audit trail, in the markup app.css draws for them.
  await waitFor(() =>
    expect(screen.getAllByText(/Recorded an inspection/).length).toBeGreaterThan(0),
  );
  expect(document.querySelector(".feed li .avatar")).not.toBeNull();
  expect(document.querySelector(".feed li .when .pom")).not.toBeNull();
});


/** Read one figure out of the readout strip, by its exact label. */
const figureOf = (label: string) =>
  [...document.querySelectorAll("dl.readout > div")]
    .find((box) => box.querySelector("dt")?.textContent === label)
    ?.querySelector("dd")?.textContent;

test("an inspector's queue is the inspector's own recordings", async () => {
  serve(INSPECTOR, [
    { ...JOB, id: "mine", filename: "mine.m4a", recorded_by_id: INSPECTOR.id },
    // Somebody else's. "Your recordings" has to be true, and matching on the
    // name would put both R. Menons in the same queue.
    {
      ...JOB,
      id: "theirs",
      filename: "theirs.m4a",
      recorded_by: "R. Menon",
      recorded_by_id: "11111111-2222-3333-4444-555555555555",
    },
    // Recorded before attribution existed: nobody's, not everybody's.
    { ...JOB, id: "older", filename: "older.m4a", recorded_by: "", recorded_by_id: "" },
  ]);

  window.location.hash = "";
  render(<App />);

  await waitFor(() => expect(screen.getByText("Your recordings")).toBeDefined());
  expect(screen.getByText("mine.m4a")).toBeDefined();
  expect(screen.queryByText("theirs.m4a")).toBeNull();
  expect(screen.queryByText("older.m4a")).toBeNull();
});

test("the role comes off the stage being stood in", async () => {
  // Held two stages with different roles on each, and the dashboard read
  // `roles.sizeset` regardless — so an approver on final was handed a
  // reviewer\'s queue the moment they switched in the rail.
  //
  // Driven through the component rather than the app, because sizeset is the
  // only stage with a pipeline today: `App` shows the not-built screen for
  // final and the dashboard never renders. The wiring is still wrong to ship,
  // and this is the seam it is wrong at.
  const both = {
    ...INSPECTOR,
    stages: ["sizeset", "final"],
    roles: { sizeset: "inspector", final: "approver" },
    can: ["record", "audit.view", "release"],
  };
  serve(both, [JOB]);

  render(
    <SessionProvider>
      <Dashboard jobs={[JOB]} stage="sizeset" onOpen={() => {}} />
    </SessionProvider>,
  );
  await waitFor(() => expect(screen.getByText("Your recordings")).toBeDefined());

  cleanup();
  render(
    <SessionProvider>
      <Dashboard jobs={[JOB]} stage="final" onOpen={() => {}} />
    </SessionProvider>,
  );
  await waitFor(() => expect(screen.getByText("Waiting for sign-off")).toBeDefined());
});

test("the fortnight panel counts the fortnight, not everything ever", async () => {
  const day = 86_400_000;
  serve(ADMIN, [
    { ...JOB, id: "recent", unconfirmed: 0, out_of_tolerance: 0 },
    // Six weeks old: on the books, off the chart, and it must be off the
    // figures printed beside the chart too.
    {
      ...JOB,
      id: "ancient",
      unconfirmed: 0,
      out_of_tolerance: 0,
      started_at: (Date.now() - 42 * day) / 1000,
    },
  ]);

  window.location.hash = "";
  render(<App />);

  // The strip is lifetime and says so.
  await waitFor(() => expect(figureOf("Total inspections")).toBe("2"));
  // The panel under "This fortnight" is not.
  const processed = await screen.findByText("Inspections recorded");
  expect(processed.nextElementSibling?.textContent).toBe("1 in these 14 days");
});

test("a failed inspection is accounted for on the strip", async () => {
  serve(ADMIN, [
    { ...JOB, id: "ok", unconfirmed: 0, out_of_tolerance: 0 },
    { ...JOB, id: "broken", status: "failed", error: "no measurements found" },
  ]);

  window.location.hash = "";
  render(<App />);

  await waitFor(() => expect(figureOf("Total inspections")).toBe("2"));
  // Total splits into pending, done and failed. Without the third tile the
  // arithmetic on screen is short by one and nothing says why.
  const total = Number(figureOf("Total inspections"));
  const parts =
    Number(figureOf("Pending")) + Number(figureOf("Done")) + Number(figureOf("Failed to process"));
  expect(parts).toBe(total);
});


test("the member dialog edits one stage at a time, and sends only the exceptions", async () => {
  const sent: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(url) === "/api/users") {
        sent.push(JSON.parse(String(init.body)));
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}) });
      }
      const answer =
        String(url).startsWith("/api/users") ? ROSTER
        : String(url).startsWith("/api/me") ? ADMIN
        : String(url).startsWith("/api/jobs") ? []
        : [];
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) });
    }),
  );

  window.location.hash = "#/users";
  render(<App />);
  await waitFor(() => expect(screen.getByText("Add member")).toBeDefined());
  fireEvent.click(screen.getByText("Add member"));

  // Scoped to the dialog: the rail carries the same four stage names, and a
  // global text query cannot tell a tab from a nav link.
  const tab = (name: string) =>
    [...document.querySelectorAll(".stagetabs button")].find((one) =>
      one.textContent?.includes(name),
    ) as HTMLElement;
  const pane = () => document.querySelector(".stagepane") as HTMLElement;
  const check = (label: string) =>
    [...pane().querySelectorAll("label.check")]
      .find((one) => one.textContent?.startsWith(label))
      ?.querySelector("input") as HTMLInputElement;

  // Four stages on one line, and only the selected one has a pane under it.
  expect(document.querySelectorAll(".stagetabs button").length).toBe(4);
  expect(document.querySelectorAll(".stagepane").length).toBe(1);
  expect(pane().textContent).toContain("Role on Size set");
  // A new member holds nothing, so every tab is greyed — and still clickable,
  // because granting access is the reason to go there.
  expect(document.querySelectorAll(".stagetabs button.off").length).toBe(4);
  expect([...document.querySelectorAll(".stagetabs button[disabled]")].length).toBe(0);

  // Switchable, and a stage with no role says so instead of showing an empty
  // permission list somebody might read as "allowed nothing".
  fireEvent.click(tab("Interim"));
  expect(pane().textContent).toContain("Role on Interim");
  expect(pane().textContent).toContain("No access to Interim");
  fireEvent.click(tab("Size set"));

  fireEvent.change(pane().querySelector("select") as HTMLSelectElement, {
    target: { value: "inspector" },
  });
  // Given a role, that tab stops being greyed. The other three stay.
  expect(tab("Size set").classList.contains("off")).toBe(false);
  expect(document.querySelectorAll(".stagetabs button.off").length).toBe(3);

  // An inspector does not manage the library, so granting it is an exception.
  expect(check("Manage the style set library").checked).toBe(false);
  fireEvent.click(check("Manage the style set library"));
  expect(pane().textContent).toContain("granted");

  // Ticking something the role already carries is not an exception and must
  // not be stored as one — otherwise a later change to what an inspector
  // means silently stops reaching this person.
  expect(check("Record and upload inspections").checked).toBe(true);
  fireEvent.click(check("Record and upload inspections"));
  fireEvent.click(check("Record and upload inspections"));

  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@triburg.com" } });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Person" } });

  const add = () =>
    [...document.querySelectorAll(".dialog-foot button")].find((one) =>
      ["Add member", "Invite"].includes(one.textContent ?? ""),
    ) as HTMLButtonElement;

  // An account with no password cannot sign in, so the form does not let one
  // be made by leaving a field alone.
  expect(add().disabled).toBe(true);
  fireEvent.change(document.querySelector("#md-password") as HTMLInputElement, {
    target: { value: "a good long password" },
  });
  expect(add().disabled).toBe(false);
  fireEvent.click(add());

  await waitFor(() => expect(sent.length).toBe(1));
  expect((sent[0] as { permissions: unknown }).permissions).toEqual({
    sizeset: { "manage.styles": true },
  });
});


test("a member cannot be added without a password", async () => {
  const sent: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(url) === "/api/users") {
        sent.push(JSON.parse(String(init.body)));
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}) });
      }
      const answer =
        String(url).startsWith("/api/users") ? ROSTER
        : String(url).startsWith("/api/me") ? ADMIN
        : [];
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) });
    }),
  );

  window.location.hash = "#/users";
  render(<App />);
  await waitFor(() => expect(screen.getByText("Add member")).toBeDefined());
  fireEvent.click(screen.getByText("Add member"));

  const add = () =>
    [...document.querySelectorAll(".dialog-foot button")].find(
      (one) => one.textContent === "Add member",
    ) as HTMLButtonElement;

  // There is no invite email to follow up with, so there is no way to make an
  // account nobody can sign in to.
  expect(screen.queryByText(/Invite/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@triburg.com" } });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Person" } });
  expect(add().disabled).toBe(true);

  // And the server\'s own minimum, not a different one invented here.
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
  expect(add().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "a good long password" },
  });
  expect(add().disabled).toBe(false);

  fireEvent.click(add());
  await waitFor(() => expect(sent.length).toBe(1));
  expect((sent[0] as { password: string }).password).toBe("a good long password");
});

test("an account left without a password says so on the roster", async () => {
  // `invited` only reaches the roster from rows made before a password was
  // required. The line is what stops somebody wondering for three weeks why
  // that person cannot get in.
  serve(ADMIN);
  window.location.hash = "#/users";
  render(<App />);

  await waitFor(() => expect(screen.getByText("invited")).toBeDefined());
  expect(screen.getByText("Cannot sign in — no password set")).toBeDefined();
});


test("the alerts screen names the thing to do, and the rail carries the count", async () => {
  window.location.hash = "#/alerts";
  render(<App />);

  await waitFor(() =>
    expect(screen.getByText(/1 point of measure still has no verdict/)).toBeDefined(),
  );
  // Every row says what to go and do, not just that something is wrong.
  expect(screen.getByText("Open the graded sheet")).toBeDefined();
  expect(screen.getByText("Dismiss")).toBeDefined();
  // And the count rides the rail entry, so it is seen without opening it.
  expect(document.querySelector(".navlink .tally")?.textContent).toBe("1");
});

test("a clear floor has nothing blinking at it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(String(url).startsWith("/api/me") ? ADMIN : []),
      }),
    ),
  );

  window.location.hash = "#/alerts";
  render(<App />);

  await waitFor(() => expect(screen.getByText(/Nothing is stuck on size set/)).toBeDefined());
  expect(document.querySelector(".navlink .tally")).toBeNull();
});


test("the alert settings show the catalogue and mark what was changed", async () => {
  window.location.hash = "#/alerts";
  render(<App />);

  await waitFor(() => expect(screen.getByText("Settings")).toBeDefined());
  fireEvent.click(screen.getByText("Settings"));

  await waitFor(() => expect(screen.getByText("Readings with no verdict")).toBeDefined());

  // The threshold is typed in the rule's own unit, not converted to hours.
  const hours = screen.getByLabelText(
    "Readings with no verdict threshold in hours",
  ) as HTMLInputElement;
  expect(hours.value).toBe("4");
  // And the page says it is not the shipped answer.
  expect(screen.getByText("was 24")).toBeDefined();

  // A rule that fires on the spot has no number to argue about.
  expect(screen.getByText("immediately")).toBeDefined();

  // Two ways out per rule, and who it goes to is not a question any more.
  expect(screen.queryByText("Who it goes to")).toBeNull();
  expect(screen.getByText("How it goes out")).toBeDefined();
  expect(screen.getAllByText("In the app").length).toBe(2);
  expect(screen.getAllByText("Email").length).toBe(2);

  // Email has nowhere to go, so the boxes are off and dead, and the page says
  // why instead of offering a switch that quietly does nothing.
  const emailBoxes = [...document.querySelectorAll(".ways label.check")]
    .filter((one) => one.textContent === "Email")
    .map((one) => one.querySelector("input") as HTMLInputElement);
  expect(emailBoxes.every((box) => box.disabled && !box.checked)).toBe(true);
  expect(screen.getByText(/Email is not set up/)).toBeDefined();
  expect(screen.getByText("SMTP_HOST")).toBeDefined();

  // This rule has been taken off email, and the page marks it as changed.
  expect(screen.getByText("not the usual way")).toBeDefined();
});

test("the settings are not offered to somebody who cannot change them", async () => {
  serve(INSPECTOR);
  window.location.hash = "#/alerts";
  render(<App />);

  // The rail carries the word too, so the heading is matched, not the link.
  await waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("Alerts"));
  expect(screen.queryByText("Settings")).toBeNull();
});


test("a stage's count opens a page of every inspection it stands for", async () => {
  const day = 86_400_000;
  serve(ADMIN, [
    { ...JOB, id: "one", filename: "rec_7270(1).m4a", recorded_by: "R. Menon" },
    {
      ...JOB,
      id: "two",
      filename: "rec_7270(2).m4a",
      recorded_by: "S. Iqbal",
      unconfirmed: 2,
      started_at: (Date.now() - day) / 1000,
    },
  ]);

  window.location.hash = "#/inspections";
  render(<App />);

  // The register says two and nothing else — which two is its own page.
  const count = await screen.findByRole("link", {
    name: /Show all 2 Size set inspections for style 7270/,
  });
  expect(screen.queryByText("rec_7270(1).m4a")).toBeNull();
  expect(count.getAttribute("href")).toBe("#/style/7270/sizeset");

  window.location.hash = "#/style/7270/sizeset";
  await waitFor(() => expect(screen.getByText("rec_7270(1).m4a")).toBeDefined());
  expect(screen.getByText("rec_7270(2).m4a")).toBeDefined();
  // Described exactly as the style screen describes them, from one helper.
  expect(screen.getByText(/2 points of measure with no verdict/)).toBeDefined();
  expect(screen.getAllByText("Open report").length).toBe(2);
  // And a way back, because this is a page somebody can arrive at cold.
  expect(screen.getByText("Back to the style")).toBeDefined();
});

test("a stage with nothing in it has nothing to open", async () => {
  // A recording whose style nobody could determine. It gets a row, because
  // dropping it would hide the inspection — but there is no style behind it,
  // so nothing links out of its cells.
  serve(ADMIN, [
    {
      ...JOB,
      id: "loose",
      style_no: "",
      graded_style_no: "",
      announced_style_no: "",
      form: {},
      graded: false,
    },
  ]);

  window.location.hash = "#/inspections";
  render(<App />);

  await waitFor(() => expect(screen.getByText("No style recorded")).toBeDefined());
  // Scoped to that row: the library's own styles are listed too, and their
  // cells do link out.
  const loose = screen.getByText("No style recorded").closest("tr") as HTMLElement;
  expect(loose.querySelectorAll("a.link").length).toBe(0);
  // The count is still shown — it is the way to it that does not exist.
  expect(loose.querySelector("td.num")?.textContent).toBe("1");
});

test("the style screen shows the newest few and sends you on for the rest", async () => {
  const day = 86_400_000;
  serve(
    ADMIN,
    [0, 1, 2, 3, 4].map((n) => ({
      ...JOB,
      id: `j${n}`,
      filename: `rec_7270(${n}).m4a`,
      started_at: (Date.now() - n * day) / 1000,
    })),
  );

  window.location.hash = "#/style/7270";
  render(<App />);

  // Three of five, newest first: one busy stage must not scroll the other
  // three off a screen whose job is to show all four at once.
  await waitFor(() => expect(screen.getByText("rec_7270(0).m4a")).toBeDefined());
  expect(screen.getByText("rec_7270(2).m4a")).toBeDefined();
  expect(screen.queryByText("rec_7270(3).m4a")).toBeNull();
  expect(screen.getByText(/2 more inspections at this stage/)).toBeDefined();

  // Show all sits at the right of the heading, and goes to the stage's page.
  const all = screen.getByRole("link", {
    name: /Show all 5 Size set inspections for style 7270/,
  });
  expect(all.textContent).toBe("Show all");
  expect(all.getAttribute("href")).toBe("#/style/7270/sizeset");
});


test("alerts are split by the stage the work is at", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const answer =
        String(url).startsWith("/api/me") ? ADMIN
        : String(url).startsWith("/api/alert-rules") ? RULES
        : String(url).startsWith("/api/alerts")
          ? [
              ALERTS[0],
              {
                ...ALERTS[0],
                id: "al-2",
                stage: "final",
                rule: "awaiting_signoff",
                title: "7122(4) has been waiting for sign-off",
              },
            ]
          : [];
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) });
    }),
  );

  window.location.hash = "#/alerts";
  render(<App />);

  // Opens on the stage in the rail, showing only that stage's work.
  await waitFor(() =>
    expect(screen.getByText(/1 point of measure still has no verdict/)).toBeDefined(),
  );
  expect(screen.queryByText(/waiting for sign-off/)).toBeNull();

  const tab = (name: string) =>
    [...document.querySelectorAll(".stagetabs button")].find((one) =>
      one.textContent?.includes(name),
    ) as HTMLElement;

  // Four stages, each carrying its own count, and one selected.
  expect(document.querySelectorAll(".stagetabs button").length).toBe(4);
  expect(tab("Size set").querySelector(".tally")?.textContent).toBe("1");
  expect(tab("Final").querySelector(".tally")?.textContent).toBe("1");
  // A stage with nothing open is greyed, and still clickable.
  expect(tab("PPM").classList.contains("off")).toBe(true);
  expect(tab("Final").classList.contains("off")).toBe(false);

  fireEvent.click(tab("Final"));
  expect(screen.getByText(/waiting for sign-off/)).toBeDefined();
  expect(screen.queryByText(/1 point of measure still has no verdict/)).toBeNull();

  // An empty stage says so, and says where the rest are rather than reading
  // as "nothing is wrong anywhere".
  fireEvent.click(tab("PPM"));
  expect(screen.getByText(/Nothing is stuck on ppm/)).toBeDefined();
  expect(screen.getByText(/2 alerts are open on another stage/)).toBeDefined();

  // The rail keeps the total: it is the number somebody sees without opening
  // the screen, and a per-stage count there would hide the other three.
  expect(document.querySelector(".navlink .tally")?.textContent).toBe("2");
});


test("an inspection is named after its style, the date and the time", async () => {
  const { defaultTitle } = await import("./types");

  // Sortable on purpose: a list of these reads in order anywhere that sorts
  // by name, which a locale-formatted date does not.
  const when = new Date(2026, 8, 25, 14, 32);
  expect(defaultTitle("2463", when)).toBe("2463 - 2026-09-25 - 14:32");
  // Midnight and a single-digit month still line up.
  expect(defaultTitle("7122", new Date(2026, 0, 3, 9, 5))).toBe("7122 - 2026-01-03 - 09:05");
  // No style announced yet is not a gap to fill with a placeholder.
  expect(defaultTitle("", when)).toBe("2026-09-25 - 14:32");
});

test("the name a person gives an inspection is what every screen shows", async () => {
  serve(ADMIN, [
    { ...JOB, id: "named", title: "Henley re-check — bench 4", filename: "rec_9.m4a" },
  ]);

  window.location.hash = "#/inspection/named";
  render(<App />);

  await waitFor(() =>
    expect(document.querySelector("h1")?.textContent).toBe("Henley re-check — bench 4"),
  );
});

test("an inspection recorded before naming falls back to its recording", async () => {
  serve(ADMIN, [{ ...JOB, id: "old", title: "", filename: "rec_2463(16).mp3" }]);

  window.location.hash = "#/inspection/old";
  render(<App />);

  await waitFor(() =>
    expect(document.querySelector("h1")?.textContent).toBe("rec_2463(16).mp3"),
  );
});


/** The four roles as the server describes them, from `auth.ROLES`. */
const ROLE_FIXTURES = {
  inspector: ["record", "audit.view"],
  reviewer: ["record", "audit.view", "audit.edit", "download.working"],
  approver: ["audit.view", "download.working", "download.vendor", "release"],
};

test("no role is shown a rail entry it could never use", async () => {
  // The rail is the first thing a role sees, and a row that opens an empty
  // screen teaches people to ignore the whole thing. Checked per role rather
  // than per screen: it is the combination that goes wrong.
  const expected: Record<string, string[]> = {
    inspector: ["Dashboard", "Record inspection", "Inspection", "Style sets", "Activity"],
    reviewer: ["Dashboard", "Record inspection", "Inspection", "Style sets", "Activity"],
    // No recording: an approver signs off what other people measured.
    approver: ["Dashboard", "Inspection", "Style sets", "Activity"],
  };

  for (const [role, can] of Object.entries(ROLE_FIXTURES)) {
    cleanup();
    serve({
      ...INSPECTOR,
      name: `A ${role}`,
      admin: false,
      role,
      can,
      roles: { sizeset: role },
    });
    window.location.hash = "";
    render(<App />);

    await waitFor(() => expect(document.querySelector(".rail-nav")).not.toBeNull());
    const rows = [...document.querySelectorAll(".rail-nav .navlink")].map(
      (one) => one.querySelector(".lbl")?.textContent ?? "",
    );

    // Stages is on every rail; it is how somebody moves between them.
    expect(rows).toEqual([...expected[role], "Stages"]);
    // Alerts go to the administrators, so nobody else is offered the screen.
    expect(rows).not.toContain("Alerts");
    // And the roster is an administrator's.
    expect(rows).not.toContain("Members");
  }
});

test("an administrator is shown the two rows the others are not", async () => {
  serve(ADMIN);
  window.location.hash = "";
  render(<App />);

  await waitFor(() => expect(document.querySelector(".rail-nav")).not.toBeNull());
  const rows = [...document.querySelectorAll(".navlink")].map(
    (one) => one.querySelector(".lbl")?.textContent ?? "",
  );

  expect(rows).toContain("Alerts");
  expect(rows).toContain("Members");
});


test("a sheet with an unanswered reading offers no verdict to give", async () => {
  // The server refuses one, so the screen must not offer it. Before this it
  // did, and the answer came back as a 409 nobody read.
  serve(ADMIN, [{ ...JOB, id: "gap", unconfirmed: 1, review: "" }]);

  window.location.hash = "#/inspection/gap";
  render(<App />);

  await waitFor(() => expect(screen.getByText("Size set inspection result")).toBeDefined());
  expect(screen.getByText(/has no verdict, so there is nothing to rule on yet/)).toBeDefined();
  // No buttons to press, and a way to the screen that unblocks it.
  expect(screen.queryByRole("button", { name: "Pass with comment" })).toBeNull();
  // The verdict card has its own; the page already carries one higher up.
  const toSheet = document.querySelector(
    '.notice.warn a[href="#/inspection/gap/sheet"]',
  );
  expect(toSheet).not.toBeNull();
});

test("a settled sheet offers the three verdicts", async () => {
  serve(ADMIN, [{ ...JOB, id: "clear", unconfirmed: 0, review: "" }]);

  window.location.hash = "#/inspection/clear";
  render(<App />);

  await waitFor(() => expect(screen.getByText("Size set inspection result")).toBeDefined());
  for (const wording of ["Pass", "Pass with comment", "Fail"]) {
    expect(screen.getByRole("button", { name: wording })).toBeDefined();
  }
  expect(screen.getByText("Nobody has ruled on this sheet yet.")).toBeDefined();
});

test("release waits for the reviewer, and says it is waiting", async () => {
  serve(ADMIN, [{ ...JOB, id: "unruled", unconfirmed: 0, review: "" }]);

  window.location.hash = "#/inspection/unruled";
  render(<App />);

  await waitFor(() => expect(screen.getByText("Sign-off")).toBeDefined());
  const release = screen.getByRole("button", { name: "Release to the vendor" });
  expect(release).toHaveProperty("disabled", true);
  expect(screen.getByText(/No reviewer has ruled on this sheet yet/)).toBeDefined();
});


test("the verdict a sheet already has is not offered as a change", async () => {
  serve(ADMIN, [
    { ...JOB, id: "passed", unconfirmed: 0, review: "pass", reviewed_by: "S. Iqbal" },
  ]);

  window.location.hash = "#/inspection/passed";
  render(<App />);

  await waitFor(() => expect(screen.getByText("Size set inspection result")).toBeDefined());
  // The two it is not, and not the one it is.
  expect(screen.getByRole("button", { name: "Change to pass with comment" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Change to fail" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Change to pass" })).toBeNull();
});

test("a reviewer's verdict is the state everywhere, not just on the report", async () => {
  const day = 86_400_000;
  serve(ADMIN, [
    { ...JOB, id: "a", unconfirmed: 0, review: "pass", reviewed_by: "S. Iqbal" },
    {
      ...JOB,
      id: "b",
      unconfirmed: 0,
      review: "comment",
      review_note: "Add missing side-seam notch",
      reviewed_by: "S. Iqbal",
      started_at: (Date.now() - day) / 1000,
    },
    {
      ...JOB,
      id: "c",
      unconfirmed: 0,
      review: "fail",
      review_note: "Chest is out across every size",
      reviewed_by: "S. Iqbal",
      started_at: (Date.now() - 2 * day) / 1000,
    },
    { ...JOB, id: "d", unconfirmed: 0, review: "", started_at: (Date.now() - 3 * day) / 1000 },
  ]);

  window.location.hash = "#/style/7270/sizeset";
  render(<App />);

  await waitFor(() => expect(screen.getAllByText("Waiting for sign-off").length).toBe(2));
  // A failed sheet reads as failed, not as "waiting for sign-off".
  expect(screen.getByText("Failed")).toBeDefined();
  // And one nobody has ruled on is a reviewer's job, not an approver's.
  expect(screen.getByText("Needs review")).toBeDefined();
  // The reviewer's own words carry into the register.
  expect(screen.getByText(/Passed with comment by S. Iqbal — Add missing side-seam notch/))
    .toBeDefined();
});

test("a released report says so wherever it appears", async () => {
  serve(ADMIN, [
    {
      ...JOB,
      id: "gone",
      unconfirmed: 0,
      review: "pass",
      reviewed_by: "S. Iqbal",
      released_at: Date.now() / 1000,
      released_by: "A. Kaur",
    },
  ]);

  window.location.hash = "#/style/7270/sizeset";
  render(<App />);

  await waitFor(() => expect(screen.getByText("Released")).toBeDefined());
});


test("the alert settings are kept per stage", async () => {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const at = String(url);
      if (at.startsWith("/api/alert-rules")) asked.push(at);
      const answer =
        at.startsWith("/api/me") ? ADMIN
        : at.startsWith("/api/alert-rules") ? { ...RULES, stage: at.split("stage=")[1] ?? "" }
        : [];
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) });
    }),
  );

  window.location.hash = "#/alerts";
  render(<App />);
  await waitFor(() => expect(screen.getByText("Settings")).toBeDefined());
  fireEvent.click(screen.getByText("Settings"));

  // Opens on the stage in the rail.
  await waitFor(() => expect(asked.at(-1)).toBe("/api/alert-rules?stage=sizeset"));
  expect(screen.getByText(/These are the size set settings/)).toBeDefined();

  // Switching asks the server again: the two stages are different answers,
  // and showing one stage's numbers under another's tab would be a lie.
  const tab = [...document.querySelectorAll(".stagetabs button")].find((one) =>
    one.textContent?.includes("Final"),
  ) as HTMLElement;
  fireEvent.click(tab);
  await waitFor(() => expect(asked.at(-1)).toBe("/api/alert-rules?stage=final"));
});


test.each([
  ['ppm', 'PPM'],
  ['interim', 'Interim'],
  ['final', 'Final'],
])('the %s stage has a board of its own', async (id, name) => {
  // Three different jobs, not one shape with different words: a PPM is a
  // meeting with open points, an interim is a defect rate off a sample, a
  // final is a lot against an accept number.
  serve(ADMIN);
  try {
    window.localStorage.setItem('stage', id);
  } catch {
    /* private mode; the test still renders the default */
  }
  window.location.hash = '';
  render(<App />);

  await waitFor(() => expect(document.querySelector('h1')?.textContent).toBe(name));
  expect(screen.getByText(/no pipeline yet, so everything below is stand-in data/))
    .toBeDefined();
  // The library and the log are the floor's, not size set's, so they are not
  // walled off here.
  expect(screen.queryByText(/Switch to Size set/)).toBeNull();

  try {
    window.localStorage.removeItem('stage');
  } catch {
    /* nothing to undo */
  }
});


test('alerts sit above members, on every stage', async () => {
  serve(ADMIN);
  try {
    window.localStorage.setItem('stage', 'final');
  } catch {
    /* private mode; the default stage still resolves */
  }
  window.location.hash = '#/alerts';
  render(<App />);

  await waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Alerts'));

  // Below the hairline with the account, because neither belongs to the
  // stage above it — and in that order.
  const foot = [...document.querySelectorAll('.rail-foot .navlink')].map(
    (one) => one.querySelector('.lbl')?.textContent,
  );
  expect(foot.slice(0, 2)).toEqual(['Alerts', 'Members']);
  // And gone from the stage nav it used to live in.
  const nav = [...document.querySelectorAll('.rail > .rail-nav .navlink')].map(
    (one) => one.querySelector('.lbl')?.textContent,
  );
  expect(nav).not.toContain('Alerts');

  try {
    window.localStorage.removeItem('stage');
  } catch {
    /* nothing to undo */
  }
});


test('the rail is headed by the product, not the stage', async () => {
  serve(ADMIN);
  window.location.hash = '';
  render(<App />);

  await waitFor(() => expect(document.querySelector('.rail .mark')).not.toBeNull());

  // The one constant thing on screen used to be the one thing that kept
  // changing, and the product name appeared nowhere. It is in two pieces now
  // \u2014 the company's wordmark, then the product \u2014 so the name is read the way
  // a screen reader reads it, across both.
  const lockup = document.querySelector('.rail .brand-lockup') as HTMLElement;
  expect(lockup.querySelector('img')?.getAttribute('alt')).toBe('Triburg');
  expect(lockup.querySelector('.mark')?.textContent).toBe('QA');
  // The head is the product and nothing else. Which stage you are standing
  // in is answered by the screens under it, not by a caption on the mark.
  expect(document.querySelector('.rail .brand p')).toBeNull();
  // Nor a stage tile: the head is the product, and nothing about it
  // changes when somebody moves between stages.
  expect(document.querySelector('.rail .brand .tile')).toBeNull();
  // Switching stage is what the Stages screen is for.
  expect(document.querySelector('.teamswap')).toBeNull();
  expect(screen.getByText('Stages')).toBeDefined();
});
