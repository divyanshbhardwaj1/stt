import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAlerts, fetchJob, type Alert } from "./api";
import { Account } from "./components/Account";
import { Activity } from "./components/Activity";
import { Alerts } from "./components/Alerts";
import { AuditSheet } from "./components/AuditSheet";
import { Dashboard } from "./components/Dashboard";
import { Inspections } from "./components/Inspections";
import { Intake } from "./components/Intake";
import { JobDetail } from "./components/JobDetail";
import { Rail } from "./components/Rail";
import { SignIn } from "./components/SignIn";
import { StageBoard } from "./components/StageBoard";
import { StageInspections } from "./components/StageInspections";
import { Stages } from "./components/Stages";
import { StyleSets } from "./components/StyleSets";
import { StyleStages } from "./components/StyleStages";
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

  /**
   * The full read of the job on screen.
   *
   * The polled list is a summary: it carries the counts but not the rows
   * behind them, and not the client's own field labels. Both are derived -
   * `_rehydrate` on the server rebuilds the rows from the saved extraction -
   * and neither belongs on an endpoint polled every two seconds for every
   * inspection. Without this the report shows "2 measurements out of
   * tolerance" above an empty table as soon as the process that graded it has
   * been restarted, which reads as a bug in the grading rather than in the
   * bookkeeping.
   */
  /**
   * What is open, for the count on the rail and for the Alerts screen.
   *
   * Once on arrival, then on every navigation — not on the job poll. Reading
   * the list is what sweeps the time-based rules, and that reads every
   * inspection and writes to the database; hanging it off a two-second poll
   * would run it a thousand times an hour to keep one number on a rail
   * current. A handful of times per session is what the count is worth.
   */
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const refreshAlerts = useCallback(() => {
    fetchAlerts()
      .then(setAlerts)
      // A failing sweep must not take the app down with it: everything else on
      // every screen is still the part somebody came here for.
      .catch(() => setAlerts([]));
  }, []);
  useEffect(refreshAlerts, [refreshAlerts, route.screen]);

  const [detail, setDetail] = useState<Job | null>(null);
  useEffect(() => {
    if (!route.id) return;
    let live = true;
    fetchJob(route.id)
      .then((one) => live && setDetail(one))
      .catch(() => {
        /* the summary still renders; the poll is the source of truth */
      });
    return () => {
      live = false;
    };
  }, [route.id]);

  const polled =
    jobs.find((candidate) => candidate.id === route.id) ??
    (queued && queued.id === route.id ? queued : undefined);
  const job = useMemo(() => {
    const base =
      settled && settled.id === polled?.id && settled.rows !== polled.rows ? settled : polled;
    if (!base || !detail || detail.id !== base.id) return base;
    // The poll wins on everything it knows about - state, counts, the verdict
    // - because it is newer. The full read only fills in what the list never
    // sends, and only while the poll has nothing of its own to say.
    const bare =
      !base.flagged_rows.length && !base.unconfirmed_rows.length && !base.failed_rows.length;
    return {
      ...base,
      form_labels: base.form_labels ?? detail.form_labels,
      transcript: base.transcript ?? detail.transcript,
      ...(bare
        ? {
            flagged_rows: detail.flagged_rows,
            unconfirmed_rows: detail.unconfirmed_rows,
            failed_rows: detail.failed_rows,
          }
        : {}),
    };
  }, [settled, polled, detail]);

  const here = stageOf(stage);
  // A stage without a pipeline says so rather than drawing an empty one. This
  // is the prototype's `data-need-team` answer, and it is deliberately not a
  // permission error: it is the wrong stage, not a locked door.
  /* A stage without a pipeline still has screens worth standing in: the
     library and the log belong to the floor, not to size set, and the stage's
     own board shows what it would look like on stand-in rows. What it cannot
     do is anything that needs a recording, so those still say so. */
  const strayed =
    !here.built &&
    !["dashboard", "styles", "activity", "alerts", "stages", "account"].includes(
      route.screen,
    );

  return (
    <div className="shell">
      <Rail
        route={route}
        stage={stage}
        alerts={alerts?.length ?? 0}
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
        return (
          <Inspections
            jobs={jobs}
            onOpen={(id) => go(href("inspection", id))}
            onOpenStyle={(styleNo) => go(href("style", styleNo))}
          />
        );

      // One style and its four checks, between the style list and a report.
      case "style":
        // `#/style/2463` is the four stages; `#/style/2463/sizeset` is every
        // check at one of them, keyed on both so moving between stages is a
        // fresh component rather than one that has to reset itself.
        return route.id && route.stage ? (
          <StageInspections
            key={`${route.id}/${route.stage}`}
            styleNo={route.id}
            stageId={route.stage}
            jobs={jobs}
            onOpen={(id) => go(href("inspection", id))}
          />
        ) : route.id ? (
          <StyleStages
            key={route.id}
            styleNo={route.id}
            jobs={jobs}
            onOpen={(id) => go(href("inspection", id))}
          />
        ) : (
          <Inspections
            jobs={jobs}
            onOpen={(id) => go(href("inspection", id))}
            onOpenStyle={(styleNo) => go(href("style", styleNo))}
          />
        );

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
      case "alerts":
        return (
          <Alerts
            alerts={alerts}
            stage={stage}
            onOpen={(id) => go(href("inspection", id))}
            onChanged={refreshAlerts}
          />
        );
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
        // Three of the four stages have no pipeline, so their board is the
        // stand-in one rather than a dashboard whose every figure is zero.
        if (!here.built) {
          return (
            <StageBoard
              key={stage}
              stageId={stage}
              onOpenStyle={(styleNo: string) => go(href("style", styleNo))}
            />
          );
        }
        return (
          <Dashboard
            jobs={jobs}
            stage={stage}
            onOpen={(id) => go(href("inspection", id))}
          />
        );
    }
  }
}
