/** Text formatting shared across the report. No escaping helpers: React escapes. */

/** The form's own vocabulary. Mirrors `ACRONYMS` in report_template.py. */
const ACRONYMS = new Set(["yy", "pcd", "ph", "upc", "fob", "hps", "pom", "bom", "ny"]);

/** "yy_mini_marker" -> "YY Mini Marker", the way the client's sheet prints it. */
export const fieldLabel = (key: string): string =>
  key
    .split("_")
    .map((word) =>
      ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");

/** Loose duration for elapsed job time: "42s", "6m 51s". */
export const secs = (n: number): string =>
  n < 60 ? `${n.toFixed(0)}s` : `${Math.floor(n / 60)}m ${Math.round(n % 60)}s`;

/** Recorder clock: mm:ss, or h:mm:ss once an inspection runs past the hour. */
export function hms(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return total >= 3600
    ? `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
    : `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export const megabytes = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

/** Loose "when was this" for a list: "6 min ago", "3 h ago", then a date. */
export function since(started: number): string {
  if (!started) return "";
  const ago = Date.now() - started * 1000;
  if (ago < 3_600_000) return `${Math.max(1, Math.round(ago / 60_000))} min ago`;
  if (ago < 86_400_000) return `${Math.round(ago / 3_600_000)} h ago`;
  return new Date(started * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
