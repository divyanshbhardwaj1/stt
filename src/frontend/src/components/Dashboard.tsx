import { since } from "../format";
import { href } from "../router";
import { useSession } from "../session";
import type { Job } from "../types";

/**
 * The size-set dashboard — `demo/dashboard.html`.
 *
 * The one thing the page exists to answer, in the one saturated card this
 * screen gets. Its colour and its text both come from the role: a reviewer and
 * an approver are blocked on different things, and an inspector is blocked on
 * nothing — what they recorded is somebody else's queue now.
 *
 * The prototype's numbers are invented. Every figure here is counted from the
 * job list, and the two the server cannot answer — median review time, and how
 * many readings were settled by hand across a fortnight — are left out rather
 * than filled in. A dashboard that makes a figure up is worse than one with
 * fewer figures, because the whole point of it is being trusted at a glance.
 */

const DAY = 86_400_000;

interface Props {
  jobs: Job[];
  onOpen: (jobId: string) => void;
}

export function Dashboard({ jobs, onOpen }: Props) {
  const { me, can } = useSession();
  const role = me?.admin ? "admin" : (me?.roles?.sizeset ?? "inspector");

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

  const hero = buildHero();

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

      <section style={{ marginTop: 24 }}>
        <div className={`verdict ${hero.fill}`}>
          <span className="glyph" aria-hidden="true">
            {hero.glyph}
          </span>
          <div>
            <span className="eyebrow">{hero.eyebrow}</span>
            <h2>{hero.title}</h2>
            <p>{hero.body}</p>
            {hero.cta.length > 0 && (
              <div className="row">
                {hero.cta.map(([label, to, tone]) => (
                  <a key={label} className={`btn ${tone}`} href={to}>
                    {label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Inspections</h2>
        </div>
        <dl className="readout">
          <div>
            <dt>Total</dt>
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
            <dt>Pass</dt>
            <dd>{passRate === null ? "—" : `${passRate}%`}</dd>
          </div>
        </dl>
        <p className="lede" style={{ marginTop: 12, fontSize: 12.5 }}>
          <b>Overdue</b> is a pending inspection more than 24 hours old — there is no due date
          on an inspection, and a day is how long a recording can sit before the garment it was
          taken from has moved on. <b>Pass</b> counts only inspections that carry a verdict: a
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
              <h2>{hero.queueTitle}</h2>
              {queue.length > 0 && <span className="pill error">{queue.length}</span>}
            </div>
            <p className="lede">{hero.queueLede}</p>
            {queue.length === 0 ? (
              <div className="blank" style={{ minHeight: "18vh" }}>
                <div>
                  <h2>Nothing here</h2>
                  <p>Nothing on this stage is waiting on you.</p>
                </div>
              </div>
            ) : (
              <div className="tablewrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Inspection</th>
                      <th>Style</th>
                      <th className="num">No verdict</th>
                      <th>Waiting on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((job) => (
                      <tr key={job.id} onClick={() => onOpen(job.id)}>
                        <td>
                          <b>{job.filename}</b>
                          <div className="dim" style={{ fontSize: 11.5 }}>
                            {job.status === "failed" ? job.error || "Failed" : job.message}
                          </div>
                        </td>
                        <td className="pom">
                          {job.graded_style_no || job.announced_style_no || "—"}
                        </td>
                        <td className="num">{job.unconfirmed || "—"}</td>
                        <td>
                          <span className={`pill ${waitingTone(job)}`}>{waitingOn(job)}</span>
                        </td>
                      </tr>
                    ))}
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
          The newest inspections on this stage. Nothing is attributed yet — who recorded and who
          settled arrives with the audit trail, so this lists what happened rather than who did
          it.
        </p>
        {jobs.length === 0 ? (
          <p className="lede dim">Nothing yet.</p>
        ) : (
          <ul className="feed">
            {jobs.slice(0, 5).map((job) => (
              <li key={job.id}>
                <b>{job.filename}</b> — {job.status === "done" ? summary(job) : job.message}
                <span className="when">{since(job.started_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );

  function buildHero() {
    if (!jobs.length) {
      return {
        fill: "none",
        glyph: "·",
        eyebrow: "Nothing yet",
        title: "No inspections on this stage",
        body: "Record one, or drop a recording you already have — the pipeline does not mind which.",
        cta: can("record")
          ? ([["Record inspection", href("record"), "on-tint"]] as [string, string, string][])
          : [],
        queueTitle: "Needs attention",
        queueLede: "Nothing is blocked, because nothing has been recorded.",
      };
    }

    if (role === "approver") {
      const n = signoff.length;
      return {
        fill: n ? "pass" : "none",
        glyph: n ? "→" : "✓",
        eyebrow: "Waiting on you",
        title: n
          ? `${n} graded sheet${n === 1 ? " is" : "s are"} reviewed and waiting for your sign-off`
          : "Nothing is waiting for your sign-off",
        body: n
          ? "Every verdict is captured and every measurement sits inside tolerance. Signing off locks the sheet exactly as the reviewers left it — you cannot change a measurement and approve it in the same hand, which is the point. Nothing is sent to the vendor from this stage; that happens at Final."
          : "Anything a reviewer finishes will appear here. Until then there is nothing to sign.",
        cta: [] as [string, string, string][],
        queueTitle: "Waiting for sign-off",
        queueLede:
          "Reviewed and sitting still. Signing off locks the sheet as the reviewers left it.",
      };
    }

    if (role === "inspector") {
      return {
        fill: failed.length ? "fail" : "none",
        glyph: failed.length ? "!" : "✓",
        eyebrow: "Your recordings",
        title: failed.length
          ? `${failed.length} recording${failed.length === 1 ? "" : "s"} produced nothing`
          : "Everything recorded has gone through",
        body: failed.length
          ? "Worth recording again while the garments are still out — a take that produced nothing cannot be recovered later."
          : "Each one was transcribed and graded. A reading the recording missed is for the QA team; you do not need to do anything with it.",
        cta: can("record")
          ? ([["Record another", href("record"), "on-tint"]] as [string, string, string][])
          : [],
        queueTitle: "Your recordings",
        queueLede:
          "What happened to each one after you handed it over. Nothing here is yours to settle, except a take that produced nothing.",
      };
    }

    // Reviewer, and administrators looking across the floor.
    const blocked = open.length + failed.length;
    return {
      fill: blocked ? "open" : outOfTol ? "fail" : "pass",
      glyph: blocked ? "??" : outOfTol ? "×" : "✓",
      eyebrow: role === "admin" ? "Across the floor" : "Waiting on you",
      title: blocked
        ? `${blocked} inspection${blocked === 1 ? "" : "s"} cannot go anywhere yet`
        : outOfTol
          ? `${outOfTol} measurement${outOfTol === 1 ? "" : "s"} out of tolerance`
          : "Nothing is waiting on a reviewer",
      body: blocked
        ? `${open.length ? `${open.length} carr${open.length === 1 ? "ies a point" : "y points"} of measure the recording never ruled on, and those are not passes — transcription drops short words, so each one has to be listened back to.` : ""}${failed.length ? ` ${failed.length} failed to process at all.` : ""}`.trim()
        : outOfTol
          ? "Every point of measure was heard and ruled on. What is left is a real finding, not a gap."
          : "Every reading on this stage carries a verdict.",
      cta: [] as [string, string, string][],
      queueTitle: role === "admin" ? "Blocked across the floor" : "Needs attention",
      queueLede:
        "Ordered by what it costs to leave alone. A report with no verdict on a point of measure is not a passing report — it is an unanswered question with a deadline.",
    };
  }
}

function waitingOn(job: Job): string {
  if (job.status === "failed") return "nobody — it failed";
  if (job.status !== "done") return "the pipeline";
  if (!job.graded) return "a style set";
  if (job.unconfirmed) return "a QA reviewer";
  if (job.out_of_tolerance) return "a QA reviewer";
  return "an approver";
}

function waitingTone(job: Job): string {
  if (job.status === "failed") return "error";
  if (job.status !== "done") return "warning";
  if (job.unconfirmed) return "lavender";
  if (job.out_of_tolerance) return "error";
  return "success";
}

function summary(job: Job): string {
  if (!job.graded) return "processed, not checked against a spec sheet";
  if (job.unconfirmed)
    return `${job.rows} rows, ${job.unconfirmed} without a verdict`;
  if (job.out_of_tolerance)
    return `${job.rows} rows, ${job.out_of_tolerance} out of tolerance`;
  return `${job.rows} rows, every verdict captured`;
}

/**
 * Fourteen days, one bar each: complete on the bottom, left-a-gap on top.
 *
 * Real dates, from `started_at`. An empty day is drawn as an empty column
 * rather than skipped — a gap in the work is a fact about the fortnight, and
 * dropping it would make four inspections in a week look like four in a row.
 */
function Fortnight({ jobs }: { jobs: Job[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, index) => {
    const start = today.getTime() - (13 - index) * DAY;
    const on = jobs.filter(
      (job) => job.started_at * 1000 >= start && job.started_at * 1000 < start + DAY,
    );
    return {
      start,
      complete: on.filter(
        (job) => job.status === "done" && job.graded && !job.unconfirmed,
      ).length,
      gap: on.filter(
        (job) => job.status !== "done" || !job.graded || job.unconfirmed > 0,
      ).length,
    };
  });
  const top = Math.max(1, ...days.map((day) => day.complete + day.gap));

  return (
    <div className="bars">
      {days.map((day) => (
        <div
          className="bar"
          key={day.start}
          title={`${new Date(day.start).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
          })}: ${day.complete} complete, ${day.gap} left a gap`}
        >
          <i className="ochre" style={{ height: `${(day.gap / top) * 100}%` }} />
          <i className="teal" style={{ height: `${(day.complete / top) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}
