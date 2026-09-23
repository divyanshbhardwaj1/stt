import { useState } from "react";
import { changePassword } from "../api";
import { useSession } from "../session";
import { STAGES } from "../stages";

/**
 * Account — `demo/account.html`.
 *
 * Your role is shown, never chosen: it comes from your account, and roles are
 * not yours to change. The password form is the prototype's, wired to the real
 * endpoint — which ends every session, including this one.
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
}

export function Account({ stage, onStage }: Props) {
  const { me, signOut } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!me) return null;

  const roleOn = (id: string) => (me.admin ? "admin" : (me.roles?.[id] ?? null));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNote("");
    if (next !== again) {
      setError("Those two do not match.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      // The server ends every session, including this one, so the honest
      // thing is to land on the sign-in screen rather than pretend otherwise.
      setNote("Password changed. Signing you out…");
      window.setTimeout(() => void signOut(), 900);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change it.");
      setBusy(false);
    }
  }

  return (
    <>
      <header>
        <div className="page-title">
          <h1>Account</h1>
          <span className="pill">{me.admin ? "Administrator" : "Active"}</span>
          <span className="spacer" />
          <button className="btn secondary sm" onClick={() => void signOut()}>
            Log out
          </button>
        </div>
        <p className="page-meta">Signed in as {me.email} · Shivalika QA, Gurugram</p>
      </header>

      <section>
        <div className="section-head">
          <h2>You</h2>
        </div>
        <p className="lede">
          What the audit trail records against anything you do. Your name is what appears on a
          correction; the address is only how you sign in.
        </p>
        <dl className="kv">
          <dt>Name</dt>
          <dd>{me.name}</dd>
          <dt>Email</dt>
          <dd>
            <code>{me.email}</code>
          </dd>
          <dt>Status</dt>
          <dd>{me.state === "invited" ? "Invited" : me.state === "disabled" ? "Disabled" : "Active"}</dd>
          <dt>Stages</dt>
          <dd>
            {me.stages.length} of {STAGES.length}
          </dd>
          <dt>Roles set by</dt>
          <dd>An administrator — roles are not yours to change</dd>
        </dl>
      </section>

      <section>
        <div className="section-head">
          <h2>Your stages</h2>
          <span className="pill">
            {me.stages.length} of {STAGES.length}
          </span>
        </div>
        <p className="lede">
          {me.admin
            ? "You are an administrator, so every stage is open to you — including any added later. That is what the flag means; it is not a role held four times."
            : "A role is held per stage, and a stage you hold no role on does not open. Ask an administrator to change either."}
        </p>
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>Stage</th>
                <th>What happens there</th>
                <th>Your role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {STAGES.map((entry) => {
                const role = roleOn(entry.id);
                return (
                  <tr key={entry.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className={`tile ${entry.fill}`}>{entry.tag}</span>
                        <b>{entry.name}</b>
                      </div>
                    </td>
                    <td className="why">{entry.blurb}</td>
                    <td>
                      {role ? (
                        <span className={`pill${me.admin ? " lavender" : ""}`}>
                          {ROLE_LABELS[role] ?? role}
                        </span>
                      ) : (
                        <span className="dim">no role</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {role &&
                        (entry.id === stage ? (
                          <span className="pill success">you are here</span>
                        ) : (
                          <button className="btn quiet sm" onClick={() => onStage(entry.id)}>
                            Switch
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Password</h2>
        </div>
        <p className="lede">
          Changing it signs you out everywhere, including here. A password change usually means
          somebody may have the old one, and leaving the other sessions alive would mean it had
          not actually locked anybody out.
        </p>

        {error && (
          <div className="notice bad" role="alert" style={{ marginBottom: 14 }}>
            <b>{error}</b>
          </div>
        )}
        {note && (
          <div className="notice warn" style={{ marginBottom: 14 }}>
            {note}
          </div>
        )}

        <form onSubmit={submit} style={{ maxWidth: 380 }}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label className="lbl" htmlFor="ac-current">
              Current password
            </label>
            <input
              id="ac-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label className="lbl" htmlFor="ac-next">
              New password
            </label>
            <input
              id="ac-next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
            <span className="hint">At least eight characters.</span>
          </div>
          <div className="field" style={{ marginBottom: 18 }}>
            <label className="lbl" htmlFor="ac-again">
              New password again
            </label>
            <input
              id="ac-again"
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(event) => setAgain(event.target.value)}
            />
          </div>
          <button className="btn" type="submit" disabled={busy || !current || !next}>
            {busy ? "Changing…" : "Change password"}
          </button>
        </form>
      </section>
    </>
  );
}
