import { useEffect, useState } from "react";
import { fetchLibrarySheet, type LibrarySheetDetail } from "../api";
import { demoDate, demoInspections, type DemoInspection } from "../demoStages";
import { href } from "../router";
import { STAGES, stageOf } from "../stages";
import { styleOf, type Job } from "../types";

/**
 * One style, and its four checks.
 *
 * The screen between the style list and a report. A garment passes through
 * size set, PPM, interim and final in that order, and this is the only place
 * that shows all four at once — which is the question a buyer's call actually
 * asks: not "what did we record on Tuesday" but "where is 7270 up to".
 *
 * Size set lists inspections that happened. The other three are showing
 * fabricated stand-in rows and say so on every panel, because the day one of
 * them quietly reads as real is the day this product stops being worth
 * trusting — see the header of `demoStages.ts`.
 */

interface Props {
  styleNo: string;
  jobs: Job[];
  onOpen: (jobId: string) => void;
}

/** The register's state vocabulary, for a real inspection. */
function stateOf(job: Job): [string, string] {
  if (job.status === "failed") return ["Failed", "pill error"];
  if (job.status !== "done") return ["Processing", "pill warning"];
  if (!job.graded) return ["Not graded", "pill"];
  // An open question outranks a failed measurement: a reading the recording
  // never ruled on is the one thing nobody can sign off around.
  if (job.unconfirmed > 0) return ["Needs review", "pill lavender"];
  if (job.out_of_tolerance > 0) return ["Needs review", "pill lavender"];
  return ["Waiting for sign-off", "pill success"];
}

function summarise(job: Job): string {
  if (job.status === "failed") return job.error || "Nothing was written";
  if (job.status !== "done") return job.message;
  if (!job.graded) return `${job.rows} rows · never checked against a spec sheet`;
  if (job.unconfirmed)
    return `${job.rows} rows · ${job.unconfirmed} point${
      job.unconfirmed === 1 ? "" : "s"
    } of measure with no verdict`;
  if (job.out_of_tolerance)
    return `${job.rows} rows · ${job.out_of_tolerance} out of tolerance`;
  return `${job.rows} rows · every verdict captured`;
}

export function StyleStages({ styleNo, jobs, onOpen }: Props) {
  const [sheet, setSheet] = useState<LibrarySheetDetail | null>(null);
  const [missing, setMissing] = useState(false);

  // No reset on the way in: App mounts this keyed on the style, so a
  // different style is a different component rather than this one being
  // scrubbed clean in an effect.
  useEffect(() => {
    let live = true;
    fetchLibrarySheet(styleNo)
      .then((found) => live && setSheet(found))
      // A style with inspections but no sheet on disk. The stages below are
      // still the point of this screen, so it renders without the header.
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [styleNo]);

  const mine = jobs.filter((job) => styleOf(job) === styleNo);

  return (
    <>
      <div className="crumbs">
        <a href={href("inspections")}>Inspections</a>
        <span aria-hidden="true">/</span>
        <b>Style {styleNo}</b>
      </div>

      <header>
        <div className="page-title">
          <h1>Style {styleNo}</h1>
          <span className="pill">
            {mine.length} inspection{mine.length === 1 ? "" : "s"}
          </span>
          <span className="spacer" />
          <a className="btn secondary sm" href={href("inspections")}>
            All styles
          </a>
        </div>
        <p className="page-meta">
          {sheet
            ? [sheet.description, sheet.company, sheet.season].filter(Boolean).join(" · ")
            : missing
              ? "No graded sheet in the library for this style"
              : "Reading the sheet…"}
        </p>
      </header>

      {sheet && (
        <section style={{ marginTop: 20 }}>
          <dl className="readout">
            <div>
              <dt>Sizes</dt>
              <dd className="sizes">{sheet.sizes.join(" · ") || "—"}</dd>
            </div>
            <div>
              <dt>Base size</dt>
              <dd className="sizes">{sheet.base_size || "—"}</dd>
            </div>
            <div>
              <dt>Points of measure</dt>
              <dd>{sheet.poms || "—"}</dd>
            </div>
            <div>
              <dt>Inspections</dt>
              <dd>{mine.length}</dd>
            </div>
          </dl>
        </section>
      )}

      {missing && (
        <div className="notice warn" style={{ marginTop: 20 }}>
          <b>No graded sheet in the library for style {styleNo}.</b> Its inspections are
          listed below, but nothing can be checked against spec until the buyer&apos;s sheet
          is uploaded on the <a className="link" href={href("styles")}>Style sets</a> screen.
        </div>
      )}

      {/* The four checks, in the order a garment passes through them. Every
          one gets a panel whether or not it holds anything: a stage rendered
          only when it has content is a stage somebody concludes does not
          exist. */}
      {STAGES.map((stage) => (
        <StagePanel
          key={stage.id}
          stageId={stage.id}
          styleNo={styleNo}
          jobs={mine.filter((job) => job.stage === stage.id)}
          onOpen={onOpen}
        />
      ))}
    </>
  );
}

function StagePanel({
  stageId,
  styleNo,
  jobs,
  onOpen,
}: {
  stageId: string;
  styleNo: string;
  jobs: Job[];
  onOpen: (jobId: string) => void;
}) {
  const stage = stageOf(stageId);
  const demo = stage.built ? [] : demoInspections(styleNo, stageId);
  const ordered = [...jobs].sort((a, b) => b.started_at - a.started_at);
  const count = stage.built ? ordered.length : demo.length;

  return (
    <section>
      <div className="section-head">
        <span className={`tile ${stage.fill}`} aria-hidden="true">
          {stage.tag}
        </span>
        <h2>{stage.name}</h2>
        {count > 0 && <span className="pill">{count}</span>}
      </div>
      <p className="lede">{stage.blurb}</p>

      {count === 0 ? (
        <div className="blank" style={{ minHeight: "12vh" }}>
          <div>
            <h2>Nothing yet</h2>
            <p>
              No {stage.name.toLowerCase()} inspection has been recorded for style {styleNo}.
            </p>
          </div>
        </div>
      ) : (
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>Inspection</th>
                <th>Result</th>
                <th>Date</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stage.built
                ? ordered.map((job) => {
                    const [word, tone] = stateOf(job);
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
                          <div className="dim pom" style={{ fontSize: 11.5 }}>
                            {job.recorded_by || "unattributed"}
                            {job.location ? ` · ${job.location}` : ""}
                          </div>
                        </td>
                        <td className="why">{summarise(job)}</td>
                        <td className="why">
                          {new Date(job.started_at * 1000).toLocaleDateString()}
                        </td>
                        <td>
                          <span className={tone}>{word}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <a className="btn quiet sm" href={href("inspection", job.id)}>
                            Open report
                          </a>
                        </td>
                      </tr>
                    );
                  })
                : demo.map((row: DemoInspection) => (
                    // Stand-in rows, drawn exactly as a real one is — see the
                    // header of demoStages.ts for what that costs and what
                    // still holds without the marking that used to be here.
                    <tr key={row.id}>
                      <td>
                        <b>{row.label}</b>
                        <div className="dim pom" style={{ fontSize: 11.5 }}>
                          {row.by} · {row.where}
                        </div>
                      </td>
                      <td className="why">{row.summary}</td>
                      <td className="why">{demoDate(row).toLocaleDateString()}</td>
                      <td>
                        <span className={row.tone}>{row.state}</span>
                      </td>
                      {/* Still not a link. There is no report to open, and a
                          button that opens nothing is a defect rather than a
                          label — so the cell is simply empty. */}
                      <td />
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
