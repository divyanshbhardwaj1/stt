import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const ME = {
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

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        // App renders nothing until /api/me answers, so every test here signs
        // in as an administrator: these are tests about the panes, not about
        // permissions. Those live in tests/test_auth.py, server-side, where
        // they are enforced.
        json: () => Promise.resolve(url.startsWith("/api/me") ? ME : []),
      }),
    ),
  );
  vi.stubGlobal("MediaRecorder", undefined);
});

beforeEach(() => {
  // Each test starts on the register. Routing is by hash, and jsdom keeps the
  // previous test's hash otherwise.
  window.location.hash = "";
});

test("with nothing recorded the dashboard says so and offers the recorder", async () => {
  render(<App />);

  // The dashboard is the stage's home, as demo/teams.js has it.
  await waitFor(() =>
    expect(screen.getByText("No inspections on this stage")).toBeDefined(),
  );
  expect(screen.getAllByRole("link", { name: "Record inspection" }).length).toBeGreaterThan(0);
});

test("the hero answers whether anything is waiting on you", async () => {
  render(<App />);

  await waitFor(() =>
    expect(screen.getByText(/Record one, or drop a recording you already have/)).toBeDefined(),
  );
});

test("the record screen is where the recorder lives", async () => {
  window.location.hash = "#/record";
  render(<App />);

  // The pane hand-off this file exists to protect: the recorder occupies the
  // work pane, and hands it back to the report once there is one.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Record inspection|Recording unavailable/ }),
    ).toBeDefined(),
  );
});

test("the rail hides the roster from somebody who cannot manage people", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            url.startsWith("/api/me")
              ? { ...ME, admin: false, role: "inspector", role_label: "Inspector", can: ["record", "audit.view"] }
              : [],
          ),
      }),
    ),
  );

  render(<App />);

  await waitFor(() => expect(screen.getByRole("link", { name: "Dashboard" })).toBeDefined());
  // The one link that disappears rather than going dead: an empty admin screen
  // teaches nobody anything.
  expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
  expect(screen.getByRole("link", { name: "Style sets" })).toBeDefined();
  // "Inspection", singular: the rail label comes from demo/teams.js.
  expect(screen.getByRole("link", { name: "Inspection" })).toBeDefined();
});

test("with nobody signed in the app is a sign-in screen and nothing else", async () => {
  // 401 is the normal first answer for a browser that has never signed in, or
  // whose session has since been ended by an administrator.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })),
  );

  render(<App />);

  await waitFor(() => expect(screen.getByLabelText("Email")).toBeDefined());
  expect(screen.getByLabelText("Password")).toBeDefined();
  // No workspace behind it: the rail must not render a list of inspections to
  // somebody the server has not identified.
  expect(screen.queryByText("No inspection selected")).toBeNull();
});

test("a refused sign-in shows the server's wording, not our own", async () => {
  const refusal = "That email and password do not match.";
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, options?: { method?: string }) => {
      if (url === "/api/session" && options?.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ detail: refusal }),
        });
      }
      return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
    }),
  );

  render(<App />);
  await waitFor(() => expect(screen.getByLabelText("Email")).toBeDefined());

  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "someone@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  // One message for every failure, passed through unchanged — inventing a
  // friendlier one here would undo the point of it (no account enumeration).
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(refusal));
  // A credentials failure, so it also says who to go to.
  expect(screen.getByRole("alert").textContent).toContain("ask an administrator");
});

test("a failure that is not about credentials does not offer a password reset", async () => {
  // Resetting a password does not put somebody on a stage, and saying so
  // sends them to the wrong person.
  const refusal = "“r.menon@triburg.com” is not on any stage yet. An administrator has to add them.";
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, options?: { method?: string }) =>
      Promise.resolve(
        url === "/api/session" && options?.method === "POST"
          ? { ok: false, status: 401, json: () => Promise.resolve({ detail: refusal }) }
          : { ok: false, status: 401, json: () => Promise.resolve({}) },
      ),
    ),
  );

  render(<App />);
  await waitFor(() => expect(screen.getByLabelText("Email")).toBeDefined());

  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "r.menon@triburg.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "whatever" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("not on any stage"));
  expect(screen.getByRole("alert").textContent).not.toContain("passwords cannot be recovered");
});

test("the sign-in screen is the form and nothing else", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })),
  );

  const { container } = render(<App />);

  await waitFor(() => expect(screen.getByLabelText("Email")).toBeDefined());
  // It must never enumerate who has an account — that is a prototype
  // affordance and undoes what the server does to keep the roster private.
  expect(screen.queryByText(/admin@triburg.com/)).toBeNull();
  // Nor carry the panel the prototype puts beside it. Nobody signing in for
  // the eighth time today reads it, and it is the longest thing on the page.
  expect(screen.queryByText(/Subject to Legal Action/)).toBeNull();
  expect(container.querySelector(".auth-aside")).toBeNull();
  expect(container.querySelector(".auth-solo")).not.toBeNull();
});


test("the sign-in form will not send a half-filled attempt", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })),
  );

  render(<App />);
  await waitFor(() => expect(screen.getByLabelText("Email")).toBeDefined());

  const submit = screen.getByRole("button", { name: "Sign in" });
  expect(submit).toHaveProperty("disabled", true);

  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
  expect(submit).toHaveProperty("disabled", true);

  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22" } });
  expect(submit).toHaveProperty("disabled", false);
});

test("the password can be read back, and Caps Lock is called out first", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })),
  );

  render(<App />);
  await waitFor(() => expect(screen.getByLabelText("Password")).toBeDefined());
  const password = screen.getByLabelText("Password");

  // A shared terminal and a password somebody else set.
  expect(password.getAttribute("type")).toBe("password");
  fireEvent.click(screen.getByRole("button", { name: "Show the password" }));
  expect(password.getAttribute("type")).toBe("text");

  // Said before the attempt, not after the account is locked out.
  fireEvent.keyDown(password, { key: "a", modifierCapsLock: true });
  expect(screen.getByText("Caps Lock is on.")).toBeDefined();
});
