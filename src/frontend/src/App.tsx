import { useState } from "react";
import { Intake } from "./components/Intake";
import { EmptyState, JobDetail } from "./components/JobDetail";
import { Sidebar } from "./components/Sidebar";
import { useJobs } from "./hooks/useJobs";

export default function App() {
  const { jobs, refreshNow } = useJobs();
  const [picked, setPicked] = useState<string | null>(null);

  // Derived, not synchronised: the selection is whatever the operator last
  // clicked, falling back to the newest job. That covers a job dropping off
  // the server too - the store is in memory and empties on restart - without
  // an effect writing state back on every poll.
  const job = jobs.find((candidate) => candidate.id === picked) ?? jobs[0];

  return (
    <div className="shell">
      <Sidebar jobs={jobs} selected={job?.id ?? null} onSelect={setPicked} />
      <main>
        {/* Intake fills the pane with the live transcript while recording, and
            falls back to this content the rest of the time. */}
        <Intake
          onQueued={(jobId) => {
            setPicked(jobId);
            refreshNow();
          }}
        >
          {job ? <JobDetail job={job} /> : <EmptyState />}
        </Intake>
      </main>
    </div>
  );
}
