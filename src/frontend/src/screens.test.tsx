import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App";
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
  capabilities: [{ id: "record", label: "Record and upload inspections" }],
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
