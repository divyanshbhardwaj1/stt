import { useState } from "react";
import { AuditSheet } from "./components/AuditSheet";
import { Intake } from "./components/Intake";
import { EmptyState, JobDetail } from "./components/JobDetail";
import { Sidebar } from "./components/Sidebar";
import { useJobs } from "./hooks/useJobs";
import type { Job } from "./types";

export default function App() {
  const { jobs, refreshNow } = useJobs();
  const [picked, setPicked] = useState<string | null>(null);
  /**
   * The job just accepted by the server, before any poll has returned it.
   *
   * Without this, pressing Process leaves the *previous* inspection on screen
   * for a poll cycle — pill still reading "done" — which looks like the new
   * recording produced the old report.
   */
  const [queued, setQueued] = useState<Job | null>(null);
  /**
   * The job whose graded sheet is open for audit.
   *
   * Held by id rather than as a flag, so selecting a different inspection in
   * the sidebar closes the sheet instead of showing one job's readings under
   * another job's heading.
   */
  const [auditing, setAuditing] = useState<string | null>(null);
  /**
   * A job the audit view has rebuilt, shown until the next poll catches up.
   * Settling a cell rewrites every output, so the counts and the verdict on
   * screen have to move at the moment of saving, not two seconds later.
   */
  const [settled, setSettled] = useState<Job | null>(null);

  // Derived, not synchronised: the selection is whatever the operator last
  // clicked, then the job we just queued, then the newest. That also covers a
  // job dropping off the server - the store is in memory and empties on
  // restart - without an effect writing state back on every poll.
  const polled =
    jobs.find((candidate) => candidate.id === picked) ??
    (queued && queued.id === picked ? queued : undefined) ??
    jobs[0];
  // A just-settled job wins over the poll only until the poll returns it.
  const job = settled && settled.id === polled?.id && settled.rows !== polled.rows ? settled : polled;

  return (
    <div className="shell">
      <Sidebar jobs={jobs} selected={job?.id ?? null} onSelect={setPicked} />
      <main>
        {/* Intake fills the pane with the live transcript while recording, and
            falls back to this content the rest of the time. */}
        <Intake
          onQueued={(accepted) => {
            setQueued(accepted);
            setPicked(accepted.id);
            setAuditing(null);
            refreshNow();
          }}
        >
          {job && auditing === job.id ? (
            <AuditSheet
              job={job}
              onClose={() => setAuditing(null)}
              onSettled={(rebuilt) => {
                setSettled(rebuilt);
                refreshNow();
              }}
            />
          ) : job ? (
            <JobDetail job={job} onAudit={() => setAuditing(job.id)} />
          ) : (
            <EmptyState />
          )}
        </Intake>
      </main>
    </div>
  );
}
