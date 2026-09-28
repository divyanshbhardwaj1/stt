import { DOWNLOAD_TITLES, VENDOR_DOWNLOADS, downloadUrl, releaseJob, reviewJob, REVIEW_RESULTS } from "../api";
import { href } from "../router";
import { useCallback, useState } from "react";
import { useSession } from "../session";
import { Stats } from "./Stats";
import { label } from "../types";
import type { Job } from "../types";

/**
 * One inspection's report — `demo/report.html`.
 *
 * The state decides the whole page, and that is the same switch the pipeline
 * makes: a running job has no report to show, a failed one has no numbers, and
 * an ungraded one has measurements but nothing to judge them against.
 * Rendering a half-report for any of those would be a lie with a layout.
 *
 * Two panels, as the prototype has them. The Stats tab counts everything from
 * the graded sheet; the four provenance facts the server does not record yet
 * say so there rather than being filled in with something plausible.
 */

function secs(value: number): string {
  if (!value) return "—";
  const whole = Math.round(value);
  return whole < 60 ? `${whole} s` : `${Math.floor(whole / 60)} min ${whole % 60} s`;
}

function Head({ job }: { job: Job }) {
  const state =
    job.status === "failed"
      ? ["Failed", "pill error"]
      : job.status !== "done"
        ? ["Processing", "pill warning"]
        : !job.graded
          ? ["Not graded", "pill"]
          : job.unconfirmed
            ? ["Needs review", "pill lavender"]
            : job.out_of_tolerance
              ? ["Out of tolerance", "pill error"]
              : ["Waiting for sign-off", "pill success"];
  return (
    <>
      <div className="crumbs">
        <a href={href("inspections")}>Inspections</a>
        <span aria-hidden="true">/</span>
        <b>{label(job)}</b>
      </div>

      <header>
        <div className="page-title">
          <h1>{label(job)}</h1>
          <span className={state[1]}>{state[0]}</span>
          <span className="spacer" />
          <a className="btn secondary sm" href={href("inspections")}>
            All inspections
          </a>
        </div>
        <p className="page-meta">
          {secs(job.elapsed)}
          {job.name ? (
            <>
              {" · "}
              <b>{job.name}</b>
            </>
          ) : null}
          {" · "}
          {job.graded_style_no ? (
            <>
              style <b>{job.graded_style_no}</b>
            </>
          ) : (
            "no style"
          )}
        </p>
      </header>
    </>
  );
}

function Readout({ job }: { job: Job }) {
  const graded = (value: number) => (job.graded ? String(value) : "—");
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

export function JobDetail({ job, onAudit }: { job: Job; onAudit: () => void }) {
  const { can } = useSession();
  const [panel, setPanel] = useState<"report" | "stats">("report");

  /* Two panels, as demo/report.html has them: the report asks what to do about
     this inspection, the stats ask how it behaved. Local state rather than a
     route, because which panel you were on is not worth a URL — and a link
     somebody shares should open the report. */
  const tabs = (
    <div className="tabs" style={{ margin: "20px 0 4px" }}>
      <button aria-selected={panel === "report"} onClick={() => setPanel("report")}>
        Report
      </button>
      <button aria-selected={panel === "stats"} onClick={() => setPanel("stats")}>
        Stats
      </button>
    </div>
  );

  /* ------------------------------------------------------------- failed */
  if (job.status === "failed") {
    return (
      <>
        <Head job={job} />
        <section>
          <div className="verdict none">
            <span className="glyph" aria-hidden="true">
              ×
            </span>
            <div>
              <span className="eyebrow">Verdict</span>
              <h2>No report was written</h2>
              <p>
                Nothing was written and nothing was sent anywhere. The recording is still on
                file, so it can be processed again once the reason below is settled.
              </p>
            </div>
          </div>
        </section>

        <section>
          <div className="section-head">
            <h2>Reason</h2>
          </div>
          {/* Neutral framing: the commonest cause is the audio, not a fault
              here — a test clip, or the wrong file. */}
          <div className="notice bad">
            <b>The pipeline stopped.</b>
            <pre>{job.error}</pre>
          </div>
          <div className="files" style={{ marginTop: 20 }}>
            {can("record") && (
              <a className="lead" href={href("record")}>
                Process it again
              </a>
            )}
          </div>
        </section>
      </>
    );
  }

  /* ------------------------------------------------------------ running */
  if (job.status === "running" || job.status === "queued") {
    const steps = [
      "Transcribe the recording",
      "Cross-check with a second reading",
      "Extract the inspection",
      "Check against the style set",
    ];
    // The pipeline announces a message per stage rather than a number, so the
    // step is read off the message rather than invented.
    const at = /style set|grad/i.test(job.message)
      ? 3
      : /extract/i.test(job.message)
        ? 2
        : /second|cross/i.test(job.message)
          ? 1
          : 0;
    return (
      <>
        <Head job={job} />
        <section>
          <div className="section-head">
            <h2>In progress</h2>
            <span className="pill">{secs(job.elapsed)} elapsed</span>
          </div>
          <ol className="stages">
            {steps.map((text, index) => {
              const step = index < at ? "past" : index === at ? "at" : "";
              return (
                <li key={text} className={step}>
                  <span className="tick" aria-hidden="true">
                    {step === "past" ? "✓" : step === "at" ? "→" : "·"}
                  </span>
                  {text}
                </li>
              );
            })}
          </ol>
          <div className="doing">
            <span className="spin" role="status" aria-live="polite" />
            {job.message}
          </div>
          <p className="lede" style={{ marginTop: 14 }}>
            Transcription runs for several minutes on a full inspection, and it is done twice so
            a dropped verdict shows up as a question rather than a false pass. You can close this
            tab; the work continues on the server.
          </p>
          <div className="skel" style={{ marginTop: 22 }} aria-hidden="true">
            <i style={{ width: "62%" }} />
            <i style={{ width: "88%" }} />
            <i style={{ width: "74%" }} />
          </div>
        </section>
      </>
    );
  }

  /* ------------------------------------------------------------- graded */
  const filled = Object.entries(job.form).filter(([, value]) => value);
  const unstated = Object.keys(job.form).filter((key) => !job.form[key]);
  const one = job.unconfirmed === 1;

  if (panel === "stats") {
    return (
      <>
        <Head job={job} />
        {tabs}
        <Stats job={job} />
      </>
    );
  }

  return (
    <>
      <Head job={job} />
      {tabs}

      <section>
        {!job.graded ? (
          <div className="verdict none">
            <span className="glyph" aria-hidden="true">
              –
            </span>
            <div>
              <span className="eyebrow">Verdict</span>
              <h2>Not checked against a spec sheet</h2>
              <p>
                {job.announced_style_no ? (
                  <>
                    The recording announced style <code>{job.announced_style_no}</code>, which had
                    no sheet picked for it.{" "}
                  </>
                ) : (
                  "No style was chosen and none was announced. "
                )}
                Measurements were extracted but nothing was graded. Process it again and choose a
                style to have it checked.
              </p>
            </div>
          </div>
        ) : job.unconfirmed ? (
          <div className="verdict open">
            <span className="glyph" aria-hidden="true">
              ??
            </span>
            <div>
              <span className="eyebrow">Verdict</span>
              <h2>
                Not final — {job.unconfirmed} point{one ? "" : "s"} of measure {one ? "has" : "have"}{" "}
                no verdict
              </h2>
              <p>
                The recording never ruled on {one ? "it" : "them"}. These are <b>not</b> passes:
                transcription drops short words, so each one has to be listened back to and filled
                in before this report is signed off.
                {job.out_of_tolerance
                  ? ` ${job.out_of_tolerance} measurement${job.out_of_tolerance === 1 ? "" : "s"} also came back out of tolerance.`
                  : ""}
              </p>
              <div className="row">
                {can("audit.view") && (
                  <button className="btn on-color" onClick={onAudit}>
                    Open the graded sheet
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : job.out_of_tolerance ? (
          <div className="verdict fail">
            <span className="glyph" aria-hidden="true">
              ×
            </span>
            <div>
              <span className="eyebrow">Verdict</span>
              <h2>
                {job.out_of_tolerance} measurement{job.out_of_tolerance === 1 ? "" : "s"} out of
                tolerance
              </h2>
              <p>
                Every point of measure was heard and ruled on.{" "}
                {job.out_of_tolerance === 1 ? "One sits" : `${job.out_of_tolerance} sit`} outside
                the tolerance band on style <code>{job.graded_style_no}</code>.
              </p>
              <div className="row">
                {can("audit.view") && (
                  <button className="btn on-color" onClick={onAudit}>
                    Open the graded sheet
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="verdict pass">
            <span className="glyph" aria-hidden="true">
              ✓
            </span>
            <div>
              <span className="eyebrow">Verdict</span>
              <h2>Pass — every point of measure was heard and ruled on</h2>
              <p>
                {job.judged} of {job.rows} carry a verdict and every measurement sits inside the
                tolerance band on style {job.graded_style_no}. Ready for an approver to sign off.
              </p>
              <div className="row">
                {can("audit.view") && (
                  <button className="btn on-color" onClick={onAudit}>
                    Open the graded sheet
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {job.unconfirmed_rows.length > 0 && (
        <section id="unanswered">
          <div className="section-head">
            <h2>Unanswered points of measure</h2>
            <span className="pill lavender">
              {job.unconfirmed_rows.length} of {job.unconfirmed} listed below
            </span>
          </div>
          <p className="lede">
            Listen back to each of these and record the deviation the inspector called, or the
            pass. Until then the report is not final.
          </p>
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>POM</th>
                  <th>Size</th>
                  <th>Point of measure</th>
                  <th className="num">Spec</th>
                  <th>Heard as</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {job.unconfirmed_rows.map((row) => (
                  <tr key={`${row.no}-${row.size}`}>
                    <td className="pom">{row.pom}</td>
                    <td>{row.size}</td>
                    <td>{row.description}</td>
                    <td className="num">{row.spec}</td>
                    <td className="why">{row.spoken || "—"}</td>
                    <td>
                      <span className="pill lavender">no verdict</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {job.failed_rows.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Out of tolerance</h2>
            <span className="pill error">{job.out_of_tolerance}</span>
          </div>
          <p className="lede">
            Measured against the graded spec sheet. The deviation is what the inspector called;
            the measurement is rebuilt from the sheet, not from the spoken absolute.
          </p>
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>POM</th>
                  <th>Size</th>
                  <th>Point of measure</th>
                  <th className="num">Spec</th>
                  <th className="num">Measured</th>
                  <th className="num">Deviation</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {job.failed_rows.map((row) => (
                  <tr key={`${row.no}-${row.size}`}>
                    <td className="pom">{row.pom}</td>
                    <td>{row.size}</td>
                    <td>{row.description}</td>
                    <td className="num">{row.spec}</td>
                    <td className="num">{row.measured}</td>
                    <td className="num">{row.deviation}</td>
                    <td>
                      <span className="pill error">out of tol</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {job.flagged_rows.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Worth confirming</h2>
            <span className="pill ochre">
              {job.flagged} of {job.rows} rows
            </span>
          </div>
          <p className="lede">
            Heard with less than full confidence — mid-sentence corrections, crosstalk, or a name
            the model could not place. The value may well be right.
          </p>
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Size</th>
                  <th>Point of measure</th>
                  <th className="num">Value</th>
                  <th className="num">Heard</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {job.flagged_rows.map((row) => (
                  <tr key={`${row.no}-${row.size}-${row.field}`}>
                    <td className="num">{row.no}</td>
                    <td>{row.size}</td>
                    <td>{row.field}</td>
                    <td className="num">
                      {row.value}
                      {row.deviation ? ` (${row.deviation})` : ""}
                    </td>
                    <td className="num">{Math.round(row.confidence * 100)}%</td>
                    <td className="why">{row.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <div className="section-head">
          <h2>Extracted</h2>
        </div>
        <Readout job={job} />
      </section>

      {filled.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Report header</h2>
            <span className="pill">
              {filled.length} of {filled.length + unstated.length} fields stated
            </span>
          </div>
          <dl className="kv">
            {filled.map(([key, value]) => (
              <span key={key} style={{ display: "contents" }}>
                {/* The client's own wording, off their workbook — the same
                    label the PDF prints. The field name is the fallback. */}
                <dt>{job.form_labels?.[key] ?? key.replace(/_/g, " ")}</dt>
                <dd>{value}</dd>
              </span>
            ))}
          </dl>
          {unstated.length > 0 && (
            <details className="more">
              <summary>
                {unstated.length} field{unstated.length === 1 ? "" : "s"} the recording did not
                state
              </summary>
              <div className="unstated">
                {unstated.map((field) => (
                  <span key={field}>
                    {job.form_labels?.[field] ?? field.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      <Verdict job={job} />
      <SignOff job={job} />
      <Downloads job={job} />
    </>
  );
}

/**
 * The files this account may have.
 *
 * The PDFs are the vendor-facing documents; the CSVs and the JSON are working
 * files. That split is a permission on the server, and this only avoids
 * offering a link that would answer 403.
 */
function Downloads({ job }: { job: Job }) {
  const { can } = useSession();
  const allowed = job.downloads.filter((kind) =>
    can(VENDOR_DOWNLOADS.includes(kind) ? "download.vendor" : "download.working"),
  );

  return (
    <section>
      <div className="section-head">
        <h2>Downloads</h2>
      </div>
      {job.unconfirmed > 0 && (
        <p className="notice warn" style={{ marginBottom: 16 }}>
          The report and graded sheet mark the {job.unconfirmed} unanswered point
          {job.unconfirmed === 1 ? "" : "s"} of measure in violet. Fill those in before this is
          signed off — a missing verdict is not a pass. Nothing is sent to the vendor from this
          stage; the shipment is released at <b>Final</b>.
        </p>
      )}
      {allowed.length === 0 ? (
        <p className="lede">
          The report is ready. Downloading it is an approver&apos;s job — ask one to release it.
        </p>
      ) : (
        <div className="files">
          {allowed.map((kind) => (
            <a
              key={kind}
              className={kind === "report" ? "lead" : undefined}
              href={downloadUrl(job.id, kind)}
            >
              {DOWNLOAD_TITLES[kind] ?? kind}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}


/**
 * The approver's one action, and the three reasons it is refused.
 *
 * Shown to anybody who can release, and only once there is something to
 * release: a finished, graded report. The refusals come back from the server
 * already worded for the person reading them, so they are shown as they
 * arrive rather than translated into something vaguer here.
 */
function SignOff({ job }: { job: Job }) {
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string>("");

  const sign = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const signed = await releaseJob(job.id);
      setDone(signed.released_by || "you");
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "It was not released.");
    } finally {
      setBusy(false);
    }
  }, [job.id]);

  const released = done || job.released_by;
  const when = job.released_at ? new Date(job.released_at * 1000) : null;

  if (job.status !== "done" || !job.graded) return null;

  if (released) {
    return (
      <section>
        <div className="notice good" role="status">
          <b>Released to the vendor.</b> Signed off by {released}
          {when ? ` on ${when.toLocaleDateString()}` : ""}. Nothing about this report can be
          changed now — a correction after sign-off is a new inspection.
        </div>
      </section>
    );
  }

  if (!can("release")) return null;

  return (
    <section>
      <div className="section-head">
        <h2>Sign-off</h2>
      </div>
      <p className="lede">
        Releasing sends the graded sheet and the report to the vendor as the reviewers left
        them. You cannot change a measurement and approve it in the same hand, which is the
        point rather than an inconvenience.
      </p>
      {error && (
        <div className="notice bad" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div className="row">
        <button
          className="btn"
          // Refused by the server for both of these. Saying so here is the
          // difference between a rule and a dead button.
          disabled={busy || job.unconfirmed > 0 || !job.review}
          onClick={() => void sign()}
        >
          {busy ? "Releasing…" : "Release to the vendor"}
        </button>
        {job.unconfirmed > 0 ? (
          <span className="hint">
            {job.unconfirmed} reading{job.unconfirmed === 1 ? "" : "s"} still without a
            verdict — those have to be settled first.
          </span>
        ) : !job.review ? (
          <span className="hint">
            No reviewer has ruled on this sheet yet. You sign off what a reviewer decided,
            which is why you are two people.
          </span>
        ) : null}
      </div>
    </section>
  );
}


/** How each verdict is badged, in the same vocabulary as everything else. */
const VERDICT_TONE: Record<string, string> = {
  pass: "pill success",
  comment: "pill warning",
  fail: "pill error",
};

/**
 * The reviewer's call on the sheet.
 *
 * Separate from the measurement result above it, and deliberately so. That one
 * is arithmetic — every reading against its band — and this is a judgement
 * about the garment. On a size set they disagree often: two measurements
 * outside tolerance is usually a pass with comment, because the deviation is
 * acceptable and the correction is listed. Nothing here recomputes the
 * measurement result or argues with it; both are shown, and the reader can see
 * that a person looked at the numbers and decided something else.
 */
function Verdict({ job }: { job: Job }) {
  const { can } = useSession();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [decided, setDecided] = useState<{ review: string; by: string; note: string } | null>(
    null,
  );

  const decide = useCallback(
    async (result: string) => {
      setBusy(result);
      setError("");
      try {
        const done = await reviewJob(job.id, result, note);
        setDecided({ review: done.review, by: done.reviewed_by, note: done.review_note });
      } catch (failure: unknown) {
        // The server's wording: it knows why, and phrases it for the floor.
        setError(failure instanceof Error ? failure.message : "The verdict was not saved.");
      } finally {
        setBusy("");
      }
    },
    [job.id, note],
  );

  if (job.status !== "done" || !job.graded) return null;

  const review = decided?.review ?? job.review;
  const by = decided?.by ?? job.reviewed_by;
  const said = decided?.note ?? job.review_note;
  const mayDecide = can("audit.edit") && !job.released_at;
  /* A gap is not a small deviation to weigh, it is a question nobody
     answered. The server refuses a verdict over one; the screen has to say so
     before somebody presses a button nine times, which is exactly what it let
     happen before this. */
  const blocked = job.unconfirmed > 0;

  return (
    <section>
      <div className="section-head">
        <h2>Size set inspection result</h2>
        {review && <span className={VERDICT_TONE[review]}>{REVIEW_RESULTS[review]}</span>}
      </div>
      <p className="lede">
        The reviewer&apos;s call on the garment, which is not the measurement result above —
        that one is every reading against its tolerance band, and this is whether the size set
        is good to make.
      </p>

      {review ? (
        <div className={`notice ${review === "fail" ? "bad" : "good"}`} role="status">
          <b>
            {REVIEW_RESULTS[review]}
            {by ? ` — ${by}` : ""}
          </b>
          {said ? <div style={{ marginTop: 6 }}>{said}</div> : null}
        </div>
      ) : (
        <p className="hint">Nobody has ruled on this sheet yet.</p>
      )}

      {error && (
        <div className="notice bad" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {mayDecide && blocked && (
        <div className="notice warn" style={{ marginTop: 14 }}>
          <b>
            {job.unconfirmed} point{job.unconfirmed === 1 ? "" : "s"} of measure{" "}
            {job.unconfirmed === 1 ? "has" : "have"} no verdict, so there is nothing to rule
            on yet.
          </b>{" "}
          They are not passes — each one has to be listened back to and filled in. Settle
          them on the graded sheet and this comes to life.
          <div className="row" style={{ marginTop: 10 }}>
            <a className="btn sm" href={href("inspection", job.id, "sheet")}>
              Open the graded sheet
            </a>
          </div>
        </div>
      )}

      {mayDecide && !blocked && (
        <div style={{ marginTop: 14 }}>
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="lbl" htmlFor="verdict-note">
              What the factory has to do
            </label>
            <textarea
              id="verdict-note"
              rows={3}
              placeholder="Add missing side-seam notch; rectify broken stitch at bottom hem"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <span className="hint">
              Required for a fail or a pass with comment. A message without the reason is one
              nobody can act on.
            </span>
          </div>
          <div className="row">
            {/* The verdict it already has is not a change to offer. Before
                this the card read "Change to pass" on a sheet that had just
                been passed. */}
            {Object.entries(REVIEW_RESULTS)
              .filter(([key]) => key !== review)
              .map(([key, wording]) => (
                <button
                  key={key}
                  className={`btn ${key === "fail" ? "danger" : key === "pass" ? "" : "secondary"}`}
                  disabled={Boolean(busy)}
                  onClick={() => void decide(key)}
                >
                  {busy === key
                    ? "Saving…"
                    : review
                      ? `Change to ${wording.toLowerCase()}`
                      : wording}
                </button>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
