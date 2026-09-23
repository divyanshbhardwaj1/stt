import { useState } from "react";
import { useSession } from "../session";

/**
 * Sign in — `demo/signin.html`, minus the one thing that must not ship.
 *
 * The prototype lists its accounts under the form so the demo is usable. A
 * real sign-in screen that enumerates who has an account has undone the work
 * `auth.sign_in` does to keep that private — same wording for a wrong password
 * and an unknown address, and the same cost in time. So the form is the
 * prototype's, and the id list is not here.
 *
 * The panel beside it is the prototype's too, and it earns its place: what is
 * behind this door is client audio, buyer spec sheets marked proprietary, and
 * graded sheets stamped for AEO. This is the only screen everybody sees.
 */
export function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn(email, password);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not sign in.");
      setBusy(false);
    }
  }

  // Only a credentials failure gets the credentials advice. "You are not on
  // any stage" is not fixed by resetting a password.
  const credentials = /do not match/i.test(error);

  return (
    <>
      <nav className="topbar">
        <span className="mark">Triburg&nbsp;QA</span>
        <span className="spacer" />
        <span className="muted" style={{ font: "var(--text-caption)" }}>
          Shivalika QA · Gurugram
        </span>
      </nav>

      <div className="auth-split">
        <div className="auth-form">
          <h1 className="display-md">Sign in</h1>
          <p className="lede" style={{ margin: "16px 0 28px" }}>
            Inspections you record and reports you sign off are recorded against this
            account — it is the name that appears in the audit trail. Which stages you can
            open, and what you can do on each, comes from your account.
          </p>

          {error && (
            <div className="notice bad" role="alert" style={{ marginBottom: 20 }}>
              <b>{error}</b>
              {credentials &&
                " Check the address, or ask an administrator to set a new password — passwords are not recoverable."}
            </div>
          )}

          <form onSubmit={submit}>
            <div className="field" style={{ marginBottom: 16 }}>
              <label className="lbl" htmlFor="email">
                Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                // `username`, not `email`: every password manager understands it.
                autoComplete="username"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field" style={{ marginBottom: 24 }}>
              <label className="lbl" htmlFor="password">
                Password
              </label>
              <input
                type="password"
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </div>
            <button className="btn lg" type="submit" style={{ width: "100%" }} disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="lede" style={{ marginTop: 24, fontSize: 12.5 }}>
            Accounts are created by an administrator. If you cannot sign in, ask them to
            check your address or set a new password.
          </p>
        </div>

        <div className="card cream auth-aside">
          <span className="eyebrow">What this account reaches</span>
          <h2 className="display-sm" style={{ margin: "18px 0 20px", textWrap: "pretty" }}>
            Graded sheets are vendor records, not drafts.
          </h2>
          <dl className="kv" style={{ marginBottom: 28 }}>
            <dt>Recordings</dt>
            <dd>Client audio from the inspection floor</dd>
            <dt>Spec sheets</dt>
            <dd>Buyer measurement sheets, marked proprietary</dd>
            <dt>Reports</dt>
            <dd>Stamped and sent under your name</dd>
          </dl>
          <p className="lede" style={{ margin: 0 }}>
            Every graded sheet carries the line <i>“Subject to Legal Action if Disclosed
            Without Authorization from AEO.”</i> Sessions end after 12 hours on a shared
            device, and corrections are attributed to whoever was signed in when they were
            saved.
          </p>
          <div className="files" style={{ marginTop: 24 }}>
            <span className="pill">12-hour sessions</span>
            <span className="pill">Attributed edits</span>
            <span className="pill">Roles set by an administrator</span>
          </div>
        </div>
      </div>
    </>
  );
}
