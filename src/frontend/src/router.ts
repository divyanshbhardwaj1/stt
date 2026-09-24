import { useCallback, useEffect, useState } from "react";

/**
 * Hash routing, by hand.
 *
 * ponytail: react-router is 20 kB to answer a question this app asks eight
 * times. Hashes also mean the server needs no catch-all route — it serves one
 * shell at `/` and nothing else has to know the screen names.
 *
 * Add a screen: a name below, a case in App's switch, a link in the rail.
 */
export type Screen =
  | "dashboard"
  | "activity"
  | "inspections"
  | "record"
  | "inspection"
  | "style"
  | "styles"
  | "stages"
  | "users"
  | "account";

export interface Route {
  screen: Screen;
  /** The inspection being looked at for `inspection`, or the style number
      for `style` — both name the one thing the screen is about. */
  id?: string;
  /** Which tab of it: the report, or the graded sheet. */
  tab?: "report" | "sheet";
}

const SCREENS: Screen[] = [
  "dashboard",
  "activity",
  "inspections",
  "record",
  "inspection",
  "style",
  "styles",
  "stages",
  "users",
  "account",
];

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [head, id, tab] = parts;
  if (!head) return { screen: "dashboard" };
  if (head === "inspection" && id) {
    return { screen: "inspection", id, tab: tab === "sheet" ? "sheet" : "report" };
  }
  // One style, and its four stages. Without the id there is no style to show,
  // so it falls through to the list rather than rendering an empty page.
  if (head === "style" && id) return { screen: "style", id: decodeURIComponent(id) };
  // An unknown hash lands on the register rather than on a blank pane. Somebody
  // arriving from a stale bookmark should see the list, not nothing.
  return { screen: (SCREENS.includes(head as Screen) ? head : "dashboard") as Screen };
}

export function href(screen: Screen, id?: string, tab?: string): string {
  if (screen === "inspection" && id) return `#/inspection/${id}${tab ? `/${tab}` : ""}`;
  if (screen === "style" && id) return `#/style/${encodeURIComponent(id)}`;
  return screen === "dashboard" ? "#/" : `#/${screen}`;
}

export function useRoute(): { route: Route; go: (to: string) => void } {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const go = useCallback((to: string) => {
    window.location.hash = to;
    // hashchange does not fire when the hash is already what you set, which is
    // how "click the screen you are on" becomes a dead link.
    setHash(to);
  }, []);

  return { route: parse(hash), go };
}
