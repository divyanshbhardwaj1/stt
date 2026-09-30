import { demoDate, demoInspections, type DemoInspection } from "../demoStages";
import { InspectionList } from "./InspectionList";
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
        <div style={{ marginTop: 20 }}>
          <InspectionList
            rows={[
              ...mine.map((job) => {
                const [word, tone] = stateOf(job);
                return {
                  key: job.id,
                  label: label(job),
                  by: job.recorded_by,
                  where: job.location,
                  summary: summarise(job),
                  date: new Date(job.started_at * 1000),
                  state: word,
                  tone,
                  jobId: job.id,
                };
              }),
              ...demo.map((one) => ({
                key: one.id,
                label: one.label,
                by: one.by,
                where: one.where,
                summary: one.summary,
                date: demoDate(one),
                state: one.state,
                tone: one.tone,
              })),
            ]}
            onOpen={onOpen}
          />
        </div>
      )}
    </>
  );
}
