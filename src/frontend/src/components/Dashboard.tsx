import { href } from "../router";
import { useSession } from "../session";
import type { Job } from "../types";

/**
 * The size-set dashboard — `demo/dashboard.html`, against the real job list.
 *
 * The prototype's numbers were invented. Every one of these is counted from
 * what the server returns, and anything that cannot be counted is not shown:
 * a dashboard that makes a figure up is worse than one with fewer figures.
 */

interface Props {
  jobs: Job[];
  onOpen: (jobId: string) => void;
}

export function Dashboard({ jobs, onOpen }: Props) {
  const { me, can } = useSession();

  const done = jobs.filter((job) => job.status === "done");
  const running = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const failed = jobs.filter((job) => job.status === "failed");
  const open = done.filter((job) => job.unconfirmed > 0);
  const outOfTol = done.reduce((count, job) => count + job.out_of_tolerance, 0);
  const rows = done.reduce((count, job) => count + job.rows, 0);

  // The hero answers the only question worth asking on arrival: is anything
  // waiting on me? It is a sentence, not a number.
  const hero = open.length
    ? {
        tone: "warn",
        glyph: "!",
        title: `${open.length} inspection${open.length === 1 ? "" : "s"} waiting on a verdict`,
        body: "A point of measure the recording never ruled on cannot be signed off around. Open the graded sheet and settle it by hand.",
      }
    : failed.length
      ? {
          tone: "bad",
          glyph: "×",
          title: `${failed.length} recording${failed.length === 1 ? "" : "s"} failed to process`,
          body: "The audio is still on file, so each can be processed again once the reason is dealt with.",
        }
      : running.length
        ? {
            tone: "info",
            glyph: "•",
            title: `${running.length} inspection${running.length === 1 ? "" : "s"} processing`,
            body: "Transcription takes a few minutes. The register updates itself as each finishes.",
          }
        : {
            tone: "ok",
            glyph: "✓",
            title: jobs.length ? "Nothing is waiting on you" : "Nothing recorded yet",
            body: jobs.length
              ? "Every inspection on this floor has a verdict on every reading."
              : "Record an inspection, or drop a recording you already have — the pipeline does not mind which.",
          };

  return (
    <>
      <header>
        <div className="page-title">
          <h1>Size set</h1>
          <span className="pill">{me?.name}</span>
          <span className="spacer" />
          {can("record") && (
            <a className="btn sm" href={href("record")}>
              Record inspection
            </a>
          )}
        </div>
        <p className="page-meta">
          One garment per size, every point of measure against the graded sheet.
        </p>
      </header>

      <div className={`verdict ${hero.tone}`}>
        <span className="glyph" aria-hidden="true">
          {hero.glyph}
        </span>
        <div>
          <h3>{hero.title}</h3>
          <p>{hero.body}</p>
        </div>
      </div>

      <dl className="readout">
        <div>
          <dt>Inspections</dt>
          <dd>{jobs.length}</dd>
        </div>
        <div>
          <dt>Processing</dt>
          <dd>{running.length}</dd>
        </div>
        <div className={open.length ? "flag" : undefined}>
          <dt>Without a verdict</dt>
          <dd>{open.reduce((count, job) => count + job.unconfirmed, 0)}</dd>
        </div>
        <div className={outOfTol ? "flag" : undefined}>
          <dt>Out of tolerance</dt>
          <dd>{outOfTol}</dd>
        </div>
        <div>
          <dt>Measurements graded</dt>
          <dd>{rows}</dd>
        </div>
      </dl>

      <div className="section-head">
        <h2>Needs attention</h2>
        {open.length > 0 && <span className="pill error">{open.length}</span>}
      </div>
      {open.length === 0 && failed.length === 0 ? (
        <p className="lede">Nothing is blocked. The register has everything else.</p>
      ) : (
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>Inspection</th>
                <th>Style</th>
                <th className="num">No verdict</th>
                <th className="num">Out of tol</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...open, ...failed].map((job) => (
                <tr key={job.id} onClick={() => onOpen(job.id)}>
                  <td>
                    <b>{job.filename}</b>
                    <div className="dim" style={{ fontSize: 11.5 }}>
                      {job.status === "failed" ? job.error || "Failed" : job.message}
                    </div>
                  </td>
                  <td className="pom">{job.graded_style_no || job.announced_style_no || "—"}</td>
                  <td className="num">{job.unconfirmed || "—"}</td>
                  <td className="num">{job.out_of_tolerance || "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <a className="btn quiet sm" href={href("inspection", job.id)}>
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-head">
        <h2>Recent</h2>
        <span className="spacer" />
        <a className="btn quiet sm" href={href("inspections")}>
          All inspections
        </a>
      </div>
      {jobs.length === 0 ? (
        <div className="blank">
          <div>
            <h2>No inspections yet</h2>
            <p>The first recording you process will appear here.</p>
            {can("record") && (
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
                <th>Style</th>
                <th className="num">Rows</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 6).map((job) => (
                <tr key={job.id} onClick={() => onOpen(job.id)}>
                  <td>
                    <b>{job.filename}</b>
                  </td>
                  <td className="pom">{job.graded_style_no || job.announced_style_no || "—"}</td>
                  <td className="num">{job.rows || "—"}</td>
                  <td>
                    <span
                      className={`pill ${/FAIL/i.test(job.measurement_result) ? "error" : job.status === "done" ? "success" : "warning"}`}
                    >
                      {job.status === "done" ? job.measurement_result || "Not graded" : job.message}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
