import { plural } from "../format";
import type { Job } from "../types";

/**
 * The answer to the only question that matters on this screen: is this report
 * safe to send?
 *
 * Ranked by what blocks sending — a missing verdict outranks a failure, because
 * a failure is a known finding and a gap is an unanswered question. The glyph
 * and the wording carry the state as well as the colour does, so it survives a
 * greyscale print and a colour-blind reviewer.
 */
export function Verdict({ job }: { job: Job }) {
  if (!job.graded) {
    return (
      <div className="verdict is-none">
        <span className="glyph" aria-hidden="true">
          &ndash;
        </span>
        <div>
          <h3>Not checked against a spec sheet</h3>
          <p>
            The recording announced style <code>{job.announced_style_no || "none"}</code>, which has
            no sheet in <code>data/StyleSets</code>. Measurements were extracted but nothing was
            graded. Process it again and pick the style above to get a graded sheet.
          </p>
        </div>
      </div>
    );
  }

  if (job.unconfirmed) {
    const one = job.unconfirmed === 1;
    return (
      <div className="verdict is-open">
        <span className="glyph" aria-hidden="true">
          ??
        </span>
        <div>
          <h3>
            Not final &mdash; {plural(job.unconfirmed, "point")} of measure {one ? "has" : "have"} no
            verdict
          </h3>
          <p>
            The recording never ruled on {one ? "it" : "them"}. These are <b>not</b> passes:
            transcription drops short words, so each one has to be listened back to and filled in
            before this report reaches a vendor.
            {job.out_of_tolerance
              ? ` ${plural(job.out_of_tolerance, "measurement")} also came back out of tolerance.`
              : ""}
          </p>
        </div>
      </div>
    );
  }

  if (job.out_of_tolerance) {
    const one = job.out_of_tolerance === 1;
    return (
      <div className="verdict is-fail">
        <span className="glyph" aria-hidden="true">
          &times;
        </span>
        <div>
          <h3>{plural(job.out_of_tolerance, "measurement")} out of tolerance</h3>
          <p>
            Every point of measure was heard and ruled on. {one ? "One" : job.out_of_tolerance}{" "}
            {one ? "sits" : "sit"} outside the tolerance band on style{" "}
            <code>{job.graded_style_no}</code> &mdash; result{" "}
            <code>{job.measurement_result || "FAIL CONDITIONALLY"}</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="verdict is-pass">
      <span className="glyph" aria-hidden="true">
        &check;
      </span>
      <div>
        <h3>{job.measurement_result || "Pass"}</h3>
        <p>
          All {plural(job.judged, "measurement")} were heard, matched to style{" "}
          <code>{job.graded_style_no}</code>, and fall inside tolerance. Confirm the flagged values
          below before sending.
        </p>
      </div>
    </div>
  );
}
