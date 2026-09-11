import { secs } from "../format";
import type { Job } from "../types";

/**
 * A stage list, not a spinner in the middle of the content. Transcription runs
 * for minutes and the honest question is "which step, and is it stuck?"
 *
 * ponytail: the stage is inferred from the pipeline's own announce() wording.
 * Coupled to those strings on purpose - it is the only stage signal the job
 * payload carries - and it degrades to just the message if they change.
 */
const STAGES: [string, RegExp][] = [
  ["Transcribe the recording", /transcrib|reusing transcript/i],
  ["Cross-check with a second reading", /second/i],
  ["Extract the inspection", /extract/i],
  ["Check against the style set", /check/i],
];

export function Progress({ job }: { job: Job }) {
  const at = STAGES.findIndex(([, pattern]) => pattern.test(job.message || ""));

  return (
    <section>
      <h3>
        In progress <span className="count">{secs(job.elapsed)} elapsed</span>
      </h3>
      <ol className="stages">
        {STAGES.map(([text], index) => {
          const step = at < 0 ? "" : index < at ? "past" : index === at ? "at" : "";
          const tick = step === "past" ? "✓" : step === "at" ? "→" : "·";
          return (
            <li key={text} className={step}>
              <span className="tick" aria-hidden="true">
                {tick}
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
        Transcription runs for several minutes on a full inspection, and it is done twice so a
        dropped verdict shows up as a question rather than a false pass. You can close this tab; the
        work continues on the server.
      </p>
      <div className="skel" style={{ marginTop: 22 }} aria-hidden="true">
        <i style={{ width: "62%" }} />
        <i style={{ width: "88%" }} />
        <i style={{ width: "74%" }} />
      </div>
    </section>
  );
}
