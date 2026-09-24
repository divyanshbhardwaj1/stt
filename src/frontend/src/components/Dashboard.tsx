import { useEffect, useState } from "react";
import { fetchActivity, type Event } from "../api";
import { kindLabel, kindPill, plural, since } from "../format";
import { href } from "../router";
import { useSession } from "../session";
import type { Job } from "../types";

/**
 * The size-set dashboard — `demo/dashboard.html`.
 *
 * The figures first, then the queue. The prototype opens on a saturated
 * verdict card and this deliberately does not: that card answers "can THIS be
 * sent?", which is a question about one inspection, and `JobDetail` still
 * leads with it. On a register of many it restated the readout and the queue
 * underneath it in a third voice and a loud colour.
 *
 * What is still scoped to the role is the queue — a reviewer and an approver
 * are blocked on different things, and an inspector is blocked on nothing,
 * because what they recorded is somebody else's queue now.
 *
 * The prototype's numbers are invented. Every figure here is counted from the
 * job list or read off the audit trail, and the two the server cannot answer —
 * median review time, and how many readings were settled by hand across a
 * fortnight — are left out rather than filled in. A dashboard that makes a
 * figure up is worse than one with fewer figures, because the whole point of it
 * is being trusted at a glance.
 */

const DAY = 86_400_000;

/** One letter per day on the fortnight axis. The tooltip carries the rest. */
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Why an inspection is in the queue, badged.
 *
 * The prototype's vocabulary, from `SEVERITY` in demo/dashboard.html, kept in
 * its order: a gap outranks a finding.
 */
const SEVERITY: Record<string, [string, string]> = {
  open: ["no verdict", "pill lavender"],
  fail: ["out of tolerance", "pill error"],
  failed: ["failed", "pill error"],
  none: ["not graded", "pill"],
  running: ["running", "pill warning"],
  ready: ["ready", "pill success"],
};

interface Props {
  jobs: Job[];
  onOpen: (jobId: string) => void;
}

export function Dashboard({ jobs, onOpen }: Props) {
  const { me, can } = useSession();
  const role = me?.admin ? "admin" : (me?.roles?.sizeset ?? "inspector");

  /**
   * The newest five lines of this stage's log.
   *
   * The same rows the Activity screen reads, not a second list that can
   * disagree with it. Its own fetch rather than the job poll: the trail is
   * append-only and a dashboard left open does not need it every two seconds.
   */
  const [trail, setTrail] = useState<Event[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchActivity(5)
      .then((rows) => live && setTrail(rows))
      // An unreadable log must not take the dashboard down with it: the counts
      // above are the part somebody came here for.
      .catch(() => live && setTrail([]));
    return () => {
      live = false;
    };
  }, []);

  const done = jobs.filter((job) => job.status === "done");
  const running = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const failed = jobs.filter((job) => job.status === "failed");
  const open = done.filter((job) => job.graded && job.unconfirmed > 0);
  const signoff = done.filter(
    (job) => job.graded && !job.unconfirmed && !job.out_of_tolerance,
  );
  const outOfTol = done.reduce((count, job) => count + job.out_of_tolerance, 0);

  /* The six figures the floor asks for.
     Total splits three ways and nothing is counted twice: an inspection is
     still going, or it is finished and complete, or it failed to process.
     Overdue and Need attention cut across that - they are flags on the same
     inspections, not a fourth and fifth bucket. */
  const pending = [...running, ...open];
  const settledDone = done.filter((job) => !job.unconfirmed);
  /* Not an SLA - there is no due date on an inspection. A day is how long a
     recording can sit unreviewed before the garment it was taken from has
     moved on, which is the thing being measured here. */
  // Read per render, like the date in the header and the fortnight chart
  // below: the job list polls every two seconds, so this stays current on a
  // dashboard left open all day.
  const now = new Date().getTime();
  const overdue = pending.filter((job) => now - job.started_at * 1000 > DAY);
  const attention = [
    ...failed,
    ...open,
    ...done.filter((job) => job.out_of_tolerance || !job.graded),
  ];
  const needsAttention = new Set(attention.map((job) => job.id)).size;
  /* Of the inspections that carry a verdict at all. A sheet nobody has ruled
     on is not a pass waiting to happen and must not dilute the figure. */
  const judgedJobs = done.filter((job) => job.graded && job.measurement_result);
  const passed = judgedJobs.filter((job) => job.measurement_result === "PASS").length;
  const passRate = judgedJobs.length
    ? Math.round((passed / judgedJobs.length) * 100)
    : null;

  /* Whose queue this is. Ordered by what it costs to leave alone: a reading
     with no verdict outranks a measurement that failed, because a failure has
     been ruled on and a gap has not. */
  const queue =
    role === "approver"
      ? signoff
      : role === "inspector"
        ? jobs.slice(0, 8)
        : [...open, ...failed, ...done.filter((job) => job.out_of_tolerance && !job.unconfirmed)];

  const framing = queueFraming();

  return (
    <>
      <header>
        <div className="page-title">
          <h1>Today</h1>
          <span className="pill">{me?.name}</span>
          <span className="spacer" />
          {can("record") && (
            <a className="btn sm" href={href("record")}>
              Record inspection
            </a>
          )}
        </div>
        <p className="page-meta">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}{" "}
          · Shivalika QA, Gurugram
        </p>
      </header>

      {/* No hero card. The saturated verdict card belongs to one inspection —
          `JobDetail` still leads with it — and on a register of many it was a
          third telling of what the readout and the queue below already say.
          The figures open the page instead. */}
      <section style={{ marginTop: 24 }}>
        <div className="section-head">
          <h2>Inspections</h2>
        </div>
        <dl className="readout">
          <div>
            <dt>Total inspections</dt>
            <dd>{jobs.length}</dd>
          </div>
          <div>
            <dt>Pending</dt>
            <dd>{pending.length}</dd>
          </div>
          <div>
            <dt>Done</dt>
            <dd>{settledDone.length}</dd>
          </div>
          <div className={overdue.length ? "warm" : jobs.length ? "clear" : ""}>
            <dt>Overdue</dt>
            <dd>{overdue.length}</dd>
          </div>
          <div className={needsAttention ? "hot" : jobs.length ? "clear" : ""}>
            <dt>Need attention</dt>
            <dd>{needsAttention}</dd>
          </div>
          <div className={passRate === 100 ? "clear" : ""}>
            <dt>Pass %</dt>
            <dd>{passRate === null ? "—" : `${passRate}%`}</dd>
          </div>
        </dl>
        <p className="lede" style={{ marginTop: 12, fontSize: 12.5 }}>
          <b>Overdue</b> is a pending inspection more than 24 hours old — there is no due date
          on an inspection, and a day is how long a recording can sit before the garment it was
          taken from has moved on. <b>Pass %</b> counts only inspections that carry a verdict: a
          sheet nobody has ruled on is not a pass waiting to happen.
        </p>
      </section>

      <section>
        <div className="section-head">
          <h2>Measurements</h2>
        </div>
        <dl className="readout">
          <div className={open.length ? "hot" : jobs.length ? "clear" : ""}>
            <dt>No verdict</dt>
            <dd>{done.reduce((count, job) => count + job.unconfirmed, 0)}</dd>
          </div>
          <div className={outOfTol ? "warm" : jobs.length ? "clear" : ""}>
            <dt>Out of tolerance</dt>
            <dd>{outOfTol}</dd>
          </div>
          <div>
            <dt>Graded</dt>
            <dd>{done.reduce((count, job) => count + job.judged, 0)}</dd>
          </div>
          <div>
            <dt>Processing now</dt>
            <dd>{running.length}</dd>
          </div>
        </dl>
      </section>

      <section>
        <div className="dash-split">
          <div>
            <div className="section-head">
              <h2>{framing.title}</h2>
              {queue.length > 0 && (
                <span className={`pill ${role === "inspector" ? "" : "error"}`}>
                  {plural(queue.length, "item")}
                </span>
              )}
            </div>
            <p className="lede">{framing.lede}</p>
            {queue.length === 0 ? (
              // Two different emptinesses, and a floor opening this for the
              // first time should not be told its queue is clear. Nothing
              // recorded at all is a prompt; nothing blocked is a result.
              <div className="blank" style={{ minHeight: "18vh" }}>
                <div>
                  <h2>{jobs.length ? "Nothing here" : "No inspections on this stage"}</h2>
                  <p>
                    {jobs.length
                      ? "Nothing on this stage is waiting on you."
                      : "Record one, or drop a recording you already have — the pipeline does not mind which."}
                  </p>
                  {!jobs.length && can("record") && (
                    <div className="files" style={{ justifyContent: "center" }}>
                      <a className="btn" href={href("record")}>
                        Record inspection
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="tablewrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Inspection</th>
                      <th>
                        {role === "inspector" ? "What happened" : "What is blocking it"}
                      </th>
                      <th className="num">Waiting</th>
                      <th>State</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((job) => {
                      const held = blocking(job);
                      const [word, tone] = SEVERITY[held.severity];
                      return (
                        <tr
                          key={job.id}
                          onClick={(event) => {
                            // The Open link is its own target; the rest of the
                            // row is a bigger one for the same destination.
                            if ((event.target as HTMLElement).closest("a")) return;
                            onOpen(job.id);
                          }}
                        >
                          <td>
                            <b>{job.filename}</b>
                            <div className="dim pom" style={{ fontSize: 11.5 }}>
                              style {job.graded_style_no || job.announced_style_no || "—"}
                            </div>
                          </td>
                          <td>
                            {held.why}
                            <div className="why">{held.detail}</div>
                          </td>
                          <td className="num">{since(job.started_at) || "—"}</td>
                          <td>
                            <span className={tone}>{word}</span>
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
          </div>

          <div>
            <div className="section-head">
              <h2>This fortnight</h2>
            </div>
            <p className="lede">
              Inspections processed, and how many left with every verdict captured.
            </p>
            <div className="card">
              <Fortnight jobs={jobs} />
              <div className="legend">
                <span>
                  <i className="sw teal" /> Complete
                </span>
                <span>
                  <i className="sw ochre" /> Left a gap
                </span>
              </div>
              <dl className="kv" style={{ margin: "20px 0 0", maxWidth: "none" }}>
                <dt>Processed</dt>
                <dd>
                  <b>{jobs.length}</b> inspection{jobs.length === 1 ? "" : "s"}
                </dd>
                <dt>Complete first time</dt>
                <dd>
                  <b>{signoff.length}</b>
                  {done.length
                    ? ` · ${Math.round((signoff.length / done.length) * 100)}%`
                    : ""}
                </dd>
                <dt>Still open</dt>
                <dd>
                  <b>{open.length}</b> waiting on a reviewer
                </dd>
                <dt>Failed to process</dt>
                <dd>
                  <b>{failed.length}</b>
                </dd>
              </dl>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Recent activity</h2>
        </div>
        <p className="lede">
          The five newest entries in this stage&apos;s log. Every correction and every
          download is attributed — <a className="link" href={href("activity")}>see the whole
          log</a>.
        </p>
        {trail === null ? (
          <p className="lede dim">Reading the log…</p>
        ) : trail.length === 0 ? (
          <p className="lede dim">
            Nothing yet. The trail starts with the first recording, correction or download.
          </p>
        ) : (
          <ul className="feed">
            {trail.map((event) => {
              const when = new Date(event.at);
              return (
                <li key={event.id}>
                  <span className="avatar" aria-hidden="true">
                    {(event.actor || "?").slice(0, 1)}
                  </span>
                  <div className="grow">
                    <b>{event.actor || "Unattributed"}</b>{" "}
                    <span className={kindPill(event.kind)}>{kindLabel(event.kind)}</span>
                    <p>{event.what}</p>
                  </div>
                  <div className="when">
                    {when.toLocaleDateString(undefined, { day: "numeric", month: "short" })}{" "}
                    {when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    <span className="pom">{event.subject || "—"}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );

  /**
   * What the queue below is, for the role standing here.
   *
   * All that is left of the hero card: a reviewer and an approver are looking
   * at different lists, and the heading has to say which. The counts and the
   * severities are in the table itself.
   */
  function queueFraming(): { title: string; lede: string } {
    if (!jobs.length) {
      return {
        title: "Needs attention",
        lede: "Nothing is blocked, because nothing has been recorded.",
      };
    }
    if (role === "approver") {
      return {
        title: "Waiting for sign-off",
        lede:
          "Reviewed and sitting still. Signing off locks the sheet as the reviewers left it — you cannot change a measurement and approve it in the same hand, which is the point.",
      };
    }
    if (role === "inspector") {
      return {
        title: "Your recordings",
        lede:
          "What happened to each one after you handed it over. Nothing here is yours to settle, except a take that produced nothing.",
      };
    }
    // Reviewer, and administrators looking across the floor.
    return {
      title: role === "admin" ? "Blocked across the floor" : "Needs attention",
      lede:
        "Ordered by what it costs to leave alone. A report with no verdict on a point of measure is not a passing report — it is an unanswered question with a deadline.",
    };
  }
}

/**
 * What is holding one inspection up, and how loudly to say so.
 *
 * Ranked the way the product ranks findings: a gap outranks a failure, because
 * a failure has been ruled on and a gap has not.
 */
function blocking(job: Job): { why: string; detail: string; severity: string } {
  if (job.status === "failed") {
    return {
      why: "Processing failed",
      detail: job.error || "Nothing was written, and nothing was sent anywhere.",
      severity: "failed",
    };
  }
  if (job.status !== "done") {
    return { why: "Still processing", detail: job.message, severity: "running" };
  }
  if (!job.graded) {
    return {
      why: "Never checked against a spec sheet",
      detail: job.announced_style_no
        ? `The recording announced ${job.announced_style_no}; no sheet was picked.`
        : "No style was chosen and none was announced.",
      severity: "none",
    };
  }
  if (job.unconfirmed) {
    return {
      why: `${plural(job.unconfirmed, "point")} of measure ${
        job.unconfirmed === 1 ? "has" : "have"
      } no verdict`,
      detail: "Not passes — each one has to be listened back to and filled in.",
      severity: "open",
    };
  }
  if (job.out_of_tolerance) {
    return {
      why: `${plural(job.out_of_tolerance, "measurement")} out of tolerance`,
      detail: `Every point of measure was heard and ruled on, on style ${job.graded_style_no}.`,
      severity: "fail",
    };
  }
  return {
    why: "Reviewed, waiting for sign-off",
    detail: "Every verdict captured, all within tolerance.",
    severity: "ready",
  };
}

/**
 * Fourteen days, one bar each: complete on the bottom, left-a-gap on top.
 *
 * Real dates, from `started_at`. An empty day is drawn as an empty column
 * rather than skipped — a gap in the work is a fact about the fortnight, and
 * dropping it would make four inspections in a week look like four in a row.
 *
 * The markup is what app.css draws: a `.stack` sized against the busiest day,
 * split inside by how much of that day came out complete, and a one-letter
 * axis underneath. Drawn in CSS, because a charting library for fourteen pairs
 * of small integers is a dependency to keep current in exchange for nothing.
 */
function Fortnight({ jobs }: { jobs: Job[] }) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, index) => {
    const start = midnight.getTime() - (13 - index) * DAY;
    const on = jobs.filter(
      (job) => job.started_at * 1000 >= start && job.started_at * 1000 < start + DAY,
    );
    return {
      start,
      total: on.length,
      complete: on.filter((job) => job.status === "done" && job.graded && !job.unconfirmed)
        .length,
    };
  });
  const tallest = Math.max(1, ...days.map((day) => day.total));

  return (
    <div className="bars">
      {days.map((day) => {
        const when = new Date(day.start);
        // Of that day's own work, not of the fortnight: the column height
        // already says how busy the day was, so the split inside it is free to
        // answer the other question.
        const good = day.total ? Math.round((day.complete / day.total) * 100) : 0;
        const date = when.toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
        });
        return (
          <div
            className="bar"
            key={day.start}
            title={
              day.total
                ? `${date} — ${day.total} processed, ${day.complete} complete, ${
                    day.total - day.complete
                  } left a gap`
                : `${date} — nothing processed`
            }
          >
            <div
              className="stack"
              style={{ height: `${Math.round((day.total / tallest) * 100)}%` }}
            >
              <div className="gap" style={{ height: `${100 - good}%` }} />
              <div className="good" style={{ height: `${good}%` }} />
            </div>
            <span>{WEEKDAY[when.getDay()]}</span>
          </div>
        );
      })}
    </div>
  );
}
