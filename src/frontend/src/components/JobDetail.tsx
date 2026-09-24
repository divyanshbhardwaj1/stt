import { DOWNLOAD_TITLES, VENDOR_DOWNLOADS, downloadUrl } from "../api";
import { href } from "../router";
import { useState } from "react";
import { useSession } from "../session";
import { Stats } from "./Stats";
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
        <b>{job.filename}</b>
      </div>

      <header>
        <div className="page-title">
          <h1>{job.filename}</h1>
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
