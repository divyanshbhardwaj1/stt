import { useCallback, useState } from "react";
import { dismissAlert, type Alert } from "../api";
import { useSession } from "../session";
import { AlertRules } from "./AlertRules";
import { since } from "../format";
import { href } from "../router";
import { STAGES } from "../stages";

/**
 * Alerts — what needs attention, and only what this account could act on.
 *
 * Deliberately not a second dashboard. The dashboard answers "what is true
 * now" and you go to it; this answers "what changed that nobody has dealt
 * with", and every row names the thing to do and links to the screen where it
 * is done. A row that cannot be acted on has no business being here — the
 * server already filters by capability, so an approver is never handed a
 * correction they are not allowed to make.
 *
 * Split by stage, because an alert is always an alert about work at one of
 * them. A correction owed on size set and a lot waiting for release on final
 * are different jobs, usually different people, and a single list mixed them
 * into one pile ordered by nothing but time.
 *
 * Every entry also carries its own way out. An alert whose condition has been
 * fixed closes itself on the next read; dismissing is for the ones that were
 * never going to be fixed, and it is written to the audit trail because it is
 * a decision somebody made.
 */

interface Props {
  alerts: Alert[] | null;
  /** The stage in the rail. The list opens on it rather than on the first
      one, because it is the stage this person is standing in. */
  stage: string;
  onOpen: (jobId: string) => void;
  onChanged: () => void;
}

/** What each rule is telling you to go and do. */
const ACTION: Record<string, string> = {
  processing_failed: "Record it again",
  stuck: "Open the inspection",
  no_measurements: "Record it again",
  not_graded: "Process it against a sheet",
  unanswered_stale: "Open the graded sheet",
  awaiting_signoff: "Open the report",
};

export function Alerts({ alerts, stage, onOpen, onChanged }: Props) {
  const { can } = useSession();
  const [tab, setTab] = useState(stage);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  /* The settings are a different job from the list, done by a different person
     on a different day, so they get the screen to themselves rather than a
     panel above the thing they configure. One route, because they are
     obviously the same subject and a second rail entry is not. */
  const [settings, setSettings] = useState(false);

  const dismiss = useCallback(
    async (id: string) => {
      setBusy(id);
      setError("");
      try {
        await dismissAlert(id);
        onChanged();
      } catch (failure: unknown) {
        setError(failure instanceof Error ? failure.message : "It was not dismissed.");
      } finally {
        setBusy("");
      }
    },
    [onChanged],
  );

  const all = alerts ?? [];
  const count = (stageId: string) => all.filter((one) => one.stage === stageId).length;
  const live = all.filter((one) => one.stage === tab);
  const acting = live.filter((one) => one.severity === "act");
  const here = STAGES.find((one) => one.id === tab);
  const elsewhere = all.length - live.length;

  if (settings) {
    return (
      <AlertRules
        stage={tab}
        onClose={() => {
          setSettings(false);
          onChanged();
        }}
      />
    );
  }

  return (
    <>
      <header>
        <div className="page-title">
          <h1>Alerts</h1>
          <span className="pill">
            {alerts === null
              ? "…"
              : live.length === 0
                ? "clear"
                : `${live.length} open`}
          </span>
          <span className="spacer" />
          {can("manage.people") && (
            <button className="btn secondary sm" onClick={() => setSettings(true)}>
              Settings
            </button>
          )}
        </div>
        <p className="page-meta">
          Work that is stuck or at risk. Every alert goes to the administrators.
        </p>
      </header>

      {/* One line of stages. A stage with nothing open is greyed and still
          clickable, because "nothing here" is an answer somebody came for. */}
      <div className="tabs stagetabs" style={{ marginTop: 18 }}>
        {STAGES.map((one) => {
          const open = count(one.id);
          return (
            <button
              type="button"
              key={one.id}
              className={open ? undefined : "off"}
              aria-selected={tab === one.id}
              onClick={() => setTab(one.id)}
            >
              <i className={`tile ${one.fill}`}>{one.tag}</i>
              <span>{one.name}</span>
              {open > 0 && <span className="tally">{open}</span>}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="notice bad" role="alert" style={{ marginTop: 20 }}>
          {error}
        </div>
      )}

      {live.length > 0 ? (
        <>
          <div className="notice info" style={{ marginTop: 20 }}>
            <b>
              {acting.length === live.length
                ? `${acting.length} thing${acting.length === 1 ? "" : "s"} need${acting.length === 1 ? "s" : ""} doing.`
                : `${acting.length} of ${live.length} need doing.`}
            </b>{" "}
            An alert closes itself once the thing it is about is fixed — you do not have to
            come back here. Dismissing is for the ones that were never going to be fixed, and
            it goes on the record.
          </div>

          <div className="tablewrap" style={{ marginTop: 16 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>What</th>
                  <th>Since</th>
                  <th>Weight</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {live.map((one) => (
                  <tr key={one.id}>
                    <td>
                      <b>{one.title}</b>
                      <div className="why">{one.detail}</div>
                    </td>
                    <td className="why">{since(Date.parse(one.raised_at) / 1000)}</td>
                    <td>
                      <span
                        className={`pill ${one.severity === "act" ? "error" : ""}`}
                      >
                        {one.severity === "act" ? "act" : "notice"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {one.subject_id && (
                        <a
                          className="btn sm"
                          href={href("inspection", one.subject_id)}
                          onClick={(event) => {
                            event.preventDefault();
                            onOpen(one.subject_id);
                          }}
                        >
                          {ACTION[one.rule] ?? "Open"}
                        </a>
                      )}{" "}
                      <button
                        className="btn quiet sm"
                        disabled={busy === one.id}
                        onClick={() => void dismiss(one.id)}
                      >
                        {busy === one.id ? "…" : "Dismiss"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="blank" style={{ marginTop: 20 }}>
          <div>
            <div className="art" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <h2>
              {alerts === null
                ? "Checking…"
                : `Nothing is stuck on ${here?.name.toLowerCase() ?? "this stage"}`}
            </h2>
            <p>
              Every inspection here has either been dealt with or is still within the time it
              is allowed.
              {elsewhere > 0
                ? ` ${elsewhere} alert${elsewhere === 1 ? " is" : "s are"} open on another stage.`
                : ""}
            </p>
          </div>
        </div>
      )}

      <p className="lede" style={{ marginTop: 20, fontSize: 12.5 }}>
        An alert belongs to the stage the work is at. Only size set has a pipeline today, so
        the other three stay empty until they have one — the tabs are there because the alert
        already knows which stage it is about, not because they are waiting to be filled in.
      </p>
    </>
  );
}
