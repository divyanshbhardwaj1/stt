import { useMemo, useState } from "react";
import { href } from "../router";
import type { Job } from "../types";

/**
 * The inspections register — `demo/index.html`, against the real job list.
 *
 * Same markup and the same columns: the file and how long it ran, the style,
 * who recorded it and when, then rows, no-verdict, out-of-tolerance, and the
 * state. The whole row opens the report, because a table of reports where only
 * the last eight pixels are clickable is a table people learn to resent.
 */

/** The prototype's state vocabulary, mapped onto what a real job carries. */
const STATES: Record<string, [string, string]> = {
  running: ["Processing", "pill warning"],
  review: ["Needs review", "pill lavender"],
  signoff: ["Waiting for sign-off", "pill success"],
  released: ["Signed off", "pill"],
  ungraded: ["Not graded", "pill"],
  failed: ["Failed", "pill error"],
};

function stateOf(job: Job): keyof typeof STATES {
  if (job.status === "failed") return "failed";
  if (job.status !== "done") return "running";
  if (!job.graded) return "ungraded";
  // An open question outranks a failed measurement: a reading the recording
  // never ruled on is the one thing nobody can sign off around.
  if (job.unconfirmed > 0) return "review";
  if (job.out_of_tolerance > 0) return "review";
  return "signoff";
}

function elapsed(seconds: number): string {
  if (!seconds) return "—";
  const whole = Math.round(seconds);
  return whole < 60 ? `${whole} s` : `${Math.floor(whole / 60)} min ${whole % 60} s`;
}

interface Props {
  jobs: Job[];
  onOpen: (jobId: string) => void;
}

export function Inspections({ jobs, onOpen }: Props) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  /* Built from what is in the list, so a state nobody is in does not get a tab
     that returns nothing. */
  const present = useMemo(
    () => [...new Set(jobs.map(stateOf))].filter((key) => key in STATES),
    [jobs],
  );

  const matches = (job: Job) => {
    if (filter !== "all" && stateOf(job) !== filter) return false;
    if (!query) return true;
    const haystack = `${job.filename} ${job.graded_style_no} ${job.announced_style_no} ${job.name}`;
    return haystack.toLowerCase().includes(query);
  };

  const shown = jobs.filter(matches);
  const count =
    shown.length === jobs.length
      ? `${jobs.length} inspection${jobs.length === 1 ? "" : "s"}`
      : `${shown.length} of ${jobs.length}`;

  return (
    <>
      <header>
        <div className="page-title">
          <h1>Inspections</h1>
          <span className="pill">{count}</span>
          <span className="spacer" />
          <input
            type="text"
            placeholder="Search file or style"
            style={{ maxWidth: 280, height: 36 }}
            value={query}
            onChange={(event) => setQuery(event.target.value.trim().toLowerCase())}
          />
        </div>
        <p className="page-meta">Every size-set inspection on this floor. Open one for its report.</p>
      </header>

      <section style={{ marginTop: 20 }}>
        <div className="tabs" style={{ marginBottom: 14 }}>
          <button aria-selected={filter === "all"} onClick={() => setFilter("all")}>
            All
          </button>
          {present.map((key) => (
            <button
              key={key}
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
            >
              {STATES[key][0]}
            </button>
          ))}
        </div>

        {shown.length > 0 && (
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Inspection</th>
                  <th>Style</th>
                  <th>Recorded</th>
                  <th className="num">Rows</th>
                  <th className="num">No verdict</th>
                  <th className="num">Out of tol</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((job) => {
                  const key = stateOf(job);
                  return (
                    <tr
                      key={job.id}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("a")) return;
                        onOpen(job.id);
                      }}
                    >
                      <td>
                        <b>{job.filename}</b>
                        <div className="dim" style={{ fontSize: 11.5 }}>
                          {elapsed(job.elapsed)} · {job.form?.description || job.message}
                        </div>
                      </td>
                      <td className="pom">
                        {job.graded_style_no || job.announced_style_no || "—"}
                      </td>
                      <td>
                        {job.form?.date || "—"}
                        <div className="dim" style={{ fontSize: 11.5 }}>
                          {job.name}
                        </div>
                      </td>
                      <td className="num">{job.rows || "—"}</td>
                      <td
                        className="num"
                        style={job.unconfirmed ? { color: "#4c3a8a", fontWeight: 700 } : undefined}
                      >
                        {job.status === "done" ? job.unconfirmed : "—"}
                      </td>
                      <td
                        className="num"
                        style={
                          job.out_of_tolerance ? { color: "#b3261e", fontWeight: 700 } : undefined
                        }
                      >
                        {job.status === "done" ? job.out_of_tolerance : "—"}
                      </td>
                      <td>
                        <span className={STATES[key][1]}>{STATES[key][0]}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <a className="btn quiet sm" href={href("inspection", job.id)}>
                          Open
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {shown.length === 0 && (
          <div className="blank" style={{ minHeight: "26vh" }}>
            <div>
              <h2>{jobs.length === 0 ? "No inspections yet" : "Nothing matches that"}</h2>
              <p>
                {jobs.length === 0
                  ? "Record one, or drop a recording you already have — the pipeline does not mind which."
                  : "No inspection matches what you searched for."}
              </p>
              <div className="files" style={{ justifyContent: "center" }}>
                {jobs.length === 0 ? (
                  <a className="btn" href={href("record")}>
                    Record inspection
                  </a>
                ) : (
                  <button
                    className="btn secondary"
                    onClick={() => {
                      setFilter("all");
                      setQuery("");
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
