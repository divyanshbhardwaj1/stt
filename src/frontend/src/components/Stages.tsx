import { href } from "../router";
import { useSession } from "../session";
import { STAGES, stageOf } from "../stages";

/**
 * Stages — `demo/teams.html`.
 *
 * The order matters and is the first thing shown: these are not four parallel
 * products, they are one garment moving left to right.
 *
 * The prototype's per-stage counts came from mock data. The counts here are
 * the ones that are real — your role, how many screens the stage has, and
 * whether it has a pipeline at all. "Open work" is only knowable for size set,
 * so only size set shows it.
 */

const ROLE_LABELS: Record<string, string> = {
  inspector: "Inspector",
  reviewer: "QA reviewer",
  approver: "Approver",
  admin: "Administrator",
};

interface Props {
  stage: string;
  onStage: (stage: string) => void;
  /** Open inspections on size set, so the flow can say something true. */
  openWork: number;
}

export function Stages({ stage, onStage, openWork }: Props) {
  const { me, can } = useSession();
  const mine = me?.stages ?? [];

  const roleOn = (id: string) =>
    me?.admin ? "admin" : (me?.roles?.[id] ?? null);

  return (
    <>
      <header>
        <div className="page-title">
          <h1>Stages</h1>
          <span className="pill">
            {mine.length} of {STAGES.length} open to you
          </span>
          <span className="spacer" />
          {can("manage.people") && (
            <a className="btn sm" href={href("users")}>
              Manage members
            </a>
          )}
        </div>
        <p className="page-meta">
          Four stages of the check. A garment passes through all of them, in order, and the
          work at each is a different job — so the screens, the queue and your role are
          different at each.
        </p>
      </header>

      <section style={{ marginTop: 24 }}>
        <div className="stageflow">
          {STAGES.map((entry, index) => {
            const here = entry.id === stage;
            const joined = mine.includes(entry.id);
            return (
              <span key={entry.id} style={{ display: "contents" }}>
                {index > 0 && (
                  <span className="arrow" aria-hidden="true">
                    →
                  </span>
                )}
                <div className={`stage${here ? " here" : ""}${joined ? "" : " out"}`}>
                  <span className={`tile ${entry.fill}`}>{entry.tag}</span>
                  <b>{entry.name}</b>
                  <span className="n">
                    {entry.built ? `${openWork} open` : "not built"}
                  </span>
                </div>
              </span>
            );
          })}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Your stages</h2>
        </div>
        <p className="lede">
          A stage you hold no role on does not open. The same person routinely holds different
          roles at different stages — a reviewer on size set and an approver on final — because
          they are different jobs.
        </p>

        <div className="teamlist">
          {STAGES.map((entry) => {
            const role = roleOn(entry.id);
            const here = entry.id === stage;
            return (
              <article key={entry.id} className={`teamcard${here ? " here" : ""}`}>
                <div className="head">
                  <span className={`tile ${entry.fill}`}>{entry.tag}</span>
                  <div className="grow">
                    <b>{entry.name}</b>
                    <span>{entry.blurb}</span>
                  </div>
                  {here && <span className="pill success">you are here</span>}
                </div>

                <p className="lede">{entry.detail}</p>

                <dl className="facts">
                  <div>
                    <dt>Your role</dt>
                    <dd>{role ? ROLE_LABELS[role] : "—"}</dd>
                  </div>
                  <div>
                    <dt>Open work</dt>
                    <dd>{entry.built ? openWork : "—"}</dd>
                  </div>
                  <div>
                    <dt>Screens</dt>
                    <dd>{entry.nav.length}</dd>
                  </div>
                  <div>
                    <dt>Pipeline</dt>
                    <dd>{entry.built ? "Running" : "Not built"}</dd>
                  </div>
                </dl>

                <div className="foot">
                  {role ? (
                    here ? (
                      <a className="btn secondary sm" href={href(stageOf(entry.id).home)}>
                        Open {entry.name}
                      </a>
                    ) : (
                      <button className="btn sm" onClick={() => onStage(entry.id)}>
                        Switch to {entry.name}
                      </button>
                    )
                  ) : (
                    <span className="dim">
                      You are not on this stage — an administrator has to add you.
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
