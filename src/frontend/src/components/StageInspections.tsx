import { demoDate, demoInspections, type DemoInspection } from "../demoStages";
import { href } from "../router";
import { stageOf } from "../stages";
import { label, stateOf, styleOf, summarise, type Job } from "../types";

/**
 * Every check one style has had at one stage.
 *
 * A page rather than a panel that unfolds under the register. Somebody who
 * followed a count out of a list wants a screen they can link to, come back
 * from, and read without the thing they came from underneath it — and the
 * answer to "how many times have we inspected 2463 at size set" is often a
 * screenful, which is not a fold.
 *
 * The columns are the ones the style screen uses, from the same two helpers in
 * `types.ts`. Three places now describe an inspection, and a register that
 * disagreed with the page it links to would be a second, quieter source of
 * truth.
 */

interface Props {
  styleNo: string;
  stageId: string;
  jobs: Job[];
  onOpen: (jobId: string) => void;
}

export function StageInspections({ styleNo, stageId, jobs, onOpen }: Props) {
  const stage = stageOf(stageId);
  const mine = jobs
    .filter((job) => styleOf(job) === styleNo && job.stage === stageId)
    .sort((a, b) => b.started_at - a.started_at);
  const demo: DemoInspection[] = stage.built ? [] : demoInspections(styleNo, stageId);
  const count = stage.built ? mine.length : demo.length;

  return (
    <>
      <header>
        <div className="page-title">
          <span className={`tile ${stage.fill}`} aria-hidden="true">
            {stage.tag}
          </span>
          <h1>
            {stage.name} · style {styleNo}
          </h1>
          <span className="pill">
            {count} inspection{count === 1 ? "" : "s"}
          </span>
          <span className="spacer" />
          <a className="btn sm" href={href("style", styleNo)}>
            Back to the style
          </a>
        </div>
        <p className="page-meta">{stage.blurb}</p>
      </header>

      {count === 0 ? (
        <div className="blank" style={{ marginTop: 20 }}>
          <div>
            <div className="art" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <h2>Nothing yet</h2>
            <p>
              No {stage.name.toLowerCase()} inspection has been recorded for style {styleNo}.
            </p>
          </div>
        </div>
      ) : (
        <div className="tablewrap" style={{ marginTop: 20 }}>
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
              {mine.map((job) => {
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
                      <b>{label(job)}</b>
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
              })}
              {demo.map((one) => (
                <tr key={one.id}>
                  <td>
                    <b>{one.label}</b>
                    <div className="dim pom" style={{ fontSize: 11.5 }}>
                      {one.by} · {one.where}
                    </div>
                  </td>
                  <td className="why">{one.summary}</td>
                  <td className="why">{demoDate(one).toLocaleDateString()}</td>
                  <td>
                    <span className={one.tone}>{one.state}</span>
                  </td>
                  {/* No report to open, and a button that opens nothing is a
                      defect rather than a label. */}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
