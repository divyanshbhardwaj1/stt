import { useEffect, useState } from "react";
import { Account } from "./components/Account";
import { Activity } from "./components/Activity";
import { AuditSheet } from "./components/AuditSheet";
import { Dashboard } from "./components/Dashboard";
import { Inspections } from "./components/Inspections";
import { Intake } from "./components/Intake";
import { JobDetail } from "./components/JobDetail";
import { Rail } from "./components/Rail";
import { SignIn } from "./components/SignIn";
import { Stages } from "./components/Stages";
import { StyleSets } from "./components/StyleSets";
import { Users } from "./components/Users";
import { useJobs } from "./hooks/useJobs";
import { href, useRoute } from "./router";
import { SessionProvider } from "./SessionProvider";
import { useSession } from "./session";
import { STAGE_KEY, stageOf } from "./stages";
import type { Job } from "./types";

/**
 * The session gate.
 *
 * Nothing below this renders, and no polling starts, until the server has said
 * who is signed in. Mounting the workspace first and hiding it afterwards
 * would fire a poll per second against endpoints that all answer 401.
 */
export default function App() {
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
}

function Gate() {
  const { me, loading } = useSession();
  // Nothing at all rather than a spinner: /api/me answers in a millisecond on
  // the same host, and a spinner that flashes for one frame reads as a fault.
  if (loading) return null;
  if (!me) return <SignIn />;
  return <Workspace />;
}

function Workspace() {
  const { route, go } = useRoute();
  const { jobs, refreshNow } = useJobs();
  const { me } = useSession();

  /**
   * The stage being stood in. Remembered, and corrected against the account:
   * landing somebody in a stage they hold no role on is the prototype's own
   * rule, and the server would refuse everything on it anyway.
   */
  const [stage, setStage] = useState(() => {
    try {
      return window.localStorage.getItem(STAGE_KEY) || "sizeset";
    } catch {
      return "sizeset";
    }
  });
  useEffect(() => {
    const mine = me?.stages ?? [];
    const settled = mine.includes(stage) ? stage : (mine[0] ?? "sizeset");
    if (settled !== stage) setStage(settled);
    try {
      window.localStorage.setItem(STAGE_KEY, settled);
    } catch {
      /* private mode. The default stage still resolves. */
    }
  }, [stage, me]);

  /**
   * The rail's open/closed state lives on <html>, not in a class here: the
   * prototype's CSS keys off `:root[data-rail="closed"]`, and index.html sets
   * it before first paint so the rail does not flash open and snap shut.
   */
  const [closed, setClosed] = useState(
    () => document.documentElement.dataset.rail === "closed",
  );
  useEffect(() => {
    document.documentElement.dataset.rail = closed ? "closed" : "open";
    try {
      window.localStorage.setItem("rail", closed ? "closed" : "open");
    } catch {
      /* the toggle still works for this page */
    }
  }, [closed]);

  /**
   * The job just accepted by the server, before any poll has returned it.
   * Without it, pressing Process opens a report for an id the list does not
   * have yet, which renders as "not here" for a poll cycle.
   */
  const [queued, setQueued] = useState<Job | null>(null);
  /**
   * A job the audit view has rebuilt, shown until the next poll catches up.
   * Settling a cell rewrites every output, so the counts and the verdict on
   * screen have to move at the moment of saving, not two seconds later.
   */
  const [settled, setSettled] = useState<Job | null>(null);

  const polled =
    jobs.find((candidate) => candidate.id === route.id) ??
    (queued && queued.id === route.id ? queued : undefined);
  const job =
    settled && settled.id === polled?.id && settled.rows !== polled.rows ? settled : polled;

  const here = stageOf(stage);
  // A stage without a pipeline says so rather than drawing an empty one. This
  // is the prototype's `data-need-team` answer, and it is deliberately not a
  // permission error: it is the wrong stage, not a locked door.
  const strayed = !here.built && route.screen !== "stages" && route.screen !== "account";

  return (
    <div className="shell">
      <Rail
        route={route}
        stage={stage}
        onStage={(next) => {
          setStage(next);
          go(href(stageOf(next).home));
        }}
        closed={closed}
        onToggle={() => setClosed((was) => !was)}
      />
      <main>
        {/* The audit sheet fills the pane itself: it is a wide grid with its
            own head and foot, and .wrap's column would crop it. */}
        {route.screen === "inspection" && route.tab === "sheet" && job?.graded && !strayed ? (
          <AuditSheet
            job={job}
            onClose={() => go(href("inspection", job.id, "report"))}
            onSettled={(rebuilt) => {
              setSettled(rebuilt);
              refreshNow();
            }}
          />
        ) : (
          <div className="wrap">{strayed ? <NotBuilt /> : screen()}</div>
        )}
      </main>
    </div>
  );

  function NotBuilt() {
    return (
      <div className="blank">
        <div>
          <span
            className={`tile ${here.fill}`}
            aria-hidden="true"
            style={{ margin: "0 auto 16px" }}
          >
            {here.tag}
          </span>
          <h2>{here.name} is not built yet</h2>
          <p>
            {here.detail} Only size set has a pipeline behind it today — the roles here are
            real, the screens are not.
          </p>
          <div className="files" style={{ justifyContent: "center" }}>
            <button className="btn" onClick={() => setStage("sizeset")}>
              Switch to Size set
            </button>
            <a className="btn secondary" href={href("stages")}>
              See your stages
            </a>
          </div>
        </div>
      </div>
    );
  }

  function screen() {
    switch (route.screen) {
      case "record":
        return (
          <Intake
            onQueued={(accepted) => {
              setQueued(accepted);
              refreshNow();
              go(href("inspection", accepted.id));
            }}
          />
        );

      case "inspections":
        return <Inspections jobs={jobs} onOpen={(id) => go(href("inspection", id))} />;

      case "inspection":
        if (!job) {
          return (
            <div className="blank">
              <div>
                <h2>That inspection is not here</h2>
                <p>
                  It may still be arriving, or it may have been recorded before this floor
                  had a database.
                </p>
                <div className="files" style={{ justifyContent: "center" }}>
                  <a className="btn" href={href("inspections")}>
                    Back to inspections
                  </a>
                </div>
              </div>
            </div>
          );
        }
        return <JobDetail job={job} onAudit={() => go(href("inspection", job.id, "sheet"))} />;

      case "styles":
        return <StyleSets />;
      case "activity":
        return <Activity />;
      case "stages":
        return (
          <Stages
            stage={stage}
            onStage={setStage}
            openWork={jobs.filter((one) => one.status === "done" && one.unconfirmed > 0).length}
          />
        );
      case "users":
        return <Users />;
      case "account":
        return <Account stage={stage} onStage={setStage} />;

      default:
        return <Dashboard jobs={jobs} onOpen={(id) => go(href("inspection", id))} />;
    }
  }
}
