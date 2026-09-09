import { DOWNLOAD_TITLES, downloadUrl } from "../api";
import { fieldLabel, plural, secs } from "../format";
import type { Job } from "../types";
import { Progress } from "./Progress";
import { FailedTable, FlaggedTable, UnconfirmedTable } from "./Tables";
import { Verdict } from "./Verdict";

/**
 * Label-over-value pairs on a hairline strip.
 *
 * Not a grid of equal tiles: that gave "4 comments" and "12 unanswered
 * verdicts" the same visual weight, which is exactly backwards.
 */
function Readout({ job }: { job: Job }) {
  const graded = (value: number) => (job.graded ? String(value) : "—");
  // Graded, with nothing left open. Worth colouring: "0 out of tolerance" and
  // "not checked at all" are both zeroes and mean opposite things.
  const settled = job.graded && !job.out_of_tolerance && !job.unconfirmed;
  return (
    <dl className="readout">
      <div>
        <dt>Rows</dt>
        <dd>{job.rows}</dd>
      </div>
      <div>
        <dt>Sizes</dt>
        <dd className="sizes">{job.sizes.length ? job.sizes.join(" · ") : "—"}</dd>
      </div>
      <div>
        <dt>Judged</dt>
        <dd>{graded(job.judged)}</dd>
      </div>
      <div className={job.out_of_tolerance ? "warm" : settled ? "clear" : ""}>
        <dt>Out of tolerance</dt>
        <dd>{graded(job.out_of_tolerance)}</dd>
      </div>
      <div className={job.unconfirmed ? "hot" : settled ? "clear" : ""}>
        <dt>No verdict</dt>
        <dd>{graded(job.unconfirmed)}</dd>
      </div>
      <div>
        <dt>Accessories</dt>
        <dd>{job.accessories}</dd>
      </div>
      <div>
        <dt>Comments</dt>
        <dd>{job.comments}</dd>
      </div>
    </dl>
  );
}

function Header({ job }: { job: Job }) {
  return (
    <>
      <div className="title">
        <h2>{job.filename}</h2>
        <span className={`pill ${job.status}`}>{job.status}</span>
      </div>
      <div className="meta">
        {secs(job.elapsed)}
        {job.name ? <> &middot; <b>{job.name}</b></> : null}
        {job.graded_style_no ? <> &middot; style <b>{job.graded_style_no}</b></> : null}
      </div>
    </>
  );
}

export function EmptyState() {
  return (
    <div className="blank">
      <div>
        <b>No inspection selected</b>
        <p>
          Press <b>Record inspection</b> above to capture one now, or drop a recording you already
          have. Reports land in <code>data/output/</code> either way.
        </p>
      </div>
    </div>
  );
}

/**
 * The report, ordered like the workflow: open questions, then failures, then
 * things worth confirming, then the summary, then the downloads. The report is
 * offered last, after the reviewer has seen what is wrong with it.
 */
export function JobDetail({ job }: { job: Job }) {
  if (job.status === "failed") {
    return (
      <div className="wrap">
        <Header job={job} />
        <section>
          <h3>No report was written</h3>
          <div className="fail-box">
            {/* Neutral framing: the commonest cause is the audio, not a fault
                here - a test clip, or the wrong file. The reason below says
                which, so this sentence must not presume a malfunction. */}
            <b>Nothing was written and nothing was sent anywhere.</b> The recording is still in{" "}
            <code>data/recordings/</code>, so it can be processed again once the reason below is
            settled.
            <pre>{job.error}</pre>
          </div>
        </section>
      </div>
    );
  }

  if (job.status === "running" || job.status === "queued") {
    return (
      <div className="wrap">
        <Header job={job} />
        <Progress job={job} />
      </div>
    );
  }

  const filled = Object.entries(job.form).filter(([, value]) => value);
  const unstated = Object.keys(job.form).filter((key) => !job.form[key]);

  return (
    <div className="wrap">
      <Header job={job} />
      <Verdict job={job} />

      {job.unconfirmed_rows.length > 0 && (
        <section className="grave">
          <h3>
            Unanswered points of measure
            <span className="count open">
              {job.unconfirmed} of {job.judged + job.unconfirmed} listed below
            </span>
          </h3>
          <p className="lede">
            Listen back to each of these and record the deviation the inspector called, or the pass.
            Until then the report is not final.
          </p>
          <UnconfirmedTable rows={job.unconfirmed_rows} />
        </section>
      )}

      {job.failed_rows.length > 0 && (
        <section className="warn">
          <h3>
            Out of tolerance <span className="count warn">{job.out_of_tolerance}</span>
          </h3>
          <p className="lede">
            Measured against the graded spec sheet. The deviation is what the inspector called; the
            measurement is rebuilt from the sheet, not from the spoken absolute.
          </p>
          <FailedTable rows={job.failed_rows} />
        </section>
      )}

      {job.flagged_rows.length > 0 && (
        <section className="heard">
          <h3>
            Worth confirming{" "}
            <span className="count">
              {job.flagged} of {job.rows} rows
            </span>
          </h3>
          <p className="lede">
            Heard with less than full confidence &mdash; mid-sentence corrections, crosstalk, or a
            name the model could not place. The value may well be right.
          </p>
          <FlaggedTable rows={job.flagged_rows} />
        </section>
      )}

      <section>
        <h3>Extracted</h3>
        <Readout job={job} />
      </section>

      <section>
        <h3>
          Report header{" "}
          <span className="count">
            {filled.length} of {filled.length + unstated.length} fields stated
          </span>
        </h3>
        {filled.length > 0 ? (
          <dl className="kv">
            {filled.map(([key, value]) => (
              <div key={key} style={{ display: "contents" }}>
                <dt>{fieldLabel(key)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="lede">The recording stated none of the header fields.</p>
        )}
        {unstated.length > 0 && (
          <details>
            <summary>{plural(unstated.length, "field")} the recording did not state</summary>
            <div className="unstated">
              {unstated.map((key) => (
                <span key={key}>{fieldLabel(key)}</span>
              ))}
            </div>
          </details>
        )}
      </section>

      <section>
        <h3>Downloads</h3>
        {job.unconfirmed > 0 && (
          <p className="caution">
            The report and graded sheet mark the {plural(job.unconfirmed, "unanswered point")} of
            measure in violet. Fill those in before this goes to a vendor &mdash; a missing verdict
            is not a pass.
          </p>
        )}
        <div className="files">
          {job.downloads.map((kind) => (
            <a
              key={kind}
              href={downloadUrl(job.id, kind)}
              className={kind === "report" ? "lead" : undefined}
            >
              {DOWNLOAD_TITLES[kind] ?? kind}
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
