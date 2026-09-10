import { useState } from "react";
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

  // Derived, not synchronised: the selection is whatever the operator last
  // clicked, then the job we just queued, then the newest. That also covers a
  // job dropping off the server - the store is in memory and empties on
  // restart - without an effect writing state back on every poll.
  const job =
    jobs.find((candidate) => candidate.id === picked) ??
    (queued && queued.id === picked ? queued : undefined) ??
    jobs[0];

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
            refreshNow();
          }}
        >
          {job ? <JobDetail job={job} /> : <EmptyState />}
        </Intake>
      </main>
    </div>
  );
}
