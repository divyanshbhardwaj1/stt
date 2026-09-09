import { plural } from "../format";
import type { Job } from "../types";

interface Props {
  jobs: Job[];
  selected: string | null;
  onSelect: (jobId: string) => void;
}

function summary(job: Job): { text: string; open: boolean } {
  if (job.status === "failed") return { text: "Failed", open: false };
  if (job.status !== "done") return { text: job.message, open: false };
  if (job.unconfirmed) return { text: `${plural(job.unconfirmed, "verdict")} missing`, open: true };
  return { text: `${plural(job.rows, "row")} extracted`, open: false };
}

/** Navigation only. Intake lives at the top of the work pane. */
export function Sidebar({ jobs, selected, onSelect }: Props) {
  return (
    <aside>
      <div className="brand">
        <h1>Size Set Inspection</h1>
        <p>Recording &rarr; transcript &rarr; filled report</p>
      </div>
      <div className="listhead">
        Inspections <span>{jobs.length || ""}</span>
      </div>
      <div className="list">
        {jobs.length === 0 ? (
          <p className="empty">
            No inspections yet. Record one above, or drop a recording you already have.
          </p>
        ) : (
          jobs.map((job) => {
            const { text, open } = summary(job);
            return (
              <button
                key={job.id}
                className="item"
                aria-current={job.id === selected}
                onClick={() => onSelect(job.id)}
              >
                <div className="n">
                  <span className={`dot ${job.status}`} />
                  <em>{job.filename}</em>
                </div>
                <div className={`s${open ? " flag" : ""}`}>{text}</div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
