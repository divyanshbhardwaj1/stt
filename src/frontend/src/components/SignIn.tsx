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
 * The prototype puts a panel beside the form describing what the account
 * reaches. It is gone: it is the longest thing on the screen and nobody signing
 * in for the eighth time that day reads it. What it said that actually binds -
 * that edits are attributed and sessions expire - belongs in the places that
 * enforce it, which is the audit trail and the session itself.
 *
 * So the form stands alone and centred.
 */
export function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  /**
   * Caps Lock, called out before the attempt rather than after it.
   *
   * The single most common reason a password typed correctly is rejected, and
   * on a shared floor terminal nobody owns the keyboard well enough to notice
   * the light. The alternative is an account locked out by the third try.
   */
  const [caps, setCaps] = useState(false);

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
  // Both fields, or there is nothing to check. A blank submit costs a round
  // trip and a scrypt hash on the server to tell somebody what the form
  // already knows.
  const ready = Boolean(email.trim() && password) && !busy;

  const watchCaps = (event: React.KeyboardEvent<HTMLInputElement>) =>
    setCaps(event.getModifierState?.("CapsLock") ?? false);

  return (
    // The one screen with no rail beside it, and the one screen a person
    // stands at rather than works in. It gets its own scale.
    <div className="auth-screen">
      <nav className="topbar">
        <span className="mark">Triburg&nbsp;QA</span>
      </nav>

      <div className="auth-solo">
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
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError("");
                }}
                disabled={busy}
              />
            </div>
            <div className="field" style={{ marginBottom: caps ? 8 : 24 }}>
              <label className="lbl" htmlFor="password">
                Password
              </label>
              <div className="reveal">
                <input
                  type={reveal ? "text" : "password"}
                  id="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError("");
                  }}
                  onKeyDown={watchCaps}
                  onKeyUp={watchCaps}
                  onBlur={() => setCaps(false)}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="link"
                  onClick={() => setReveal((on) => !on)}
                  aria-pressed={reveal}
                  // A shared terminal and a password somebody else set: being
                  // able to see what was typed is the difference between one
                  // attempt and three.
                  aria-label={reveal ? "Hide the password" : "Show the password"}
                >
                  {reveal ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            {caps && (
              <p className="hint" style={{ marginBottom: 24 }} role="status">
                Caps Lock is on.
              </p>
            )}
            <button
              className="btn lg"
              type="submit"
              style={{ width: "100%" }}
              disabled={!ready}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="lede" style={{ marginTop: 24, fontSize: 12.5 }}>
            Accounts are created by an administrator. If you cannot sign in, ask them to
            check your address or set a new password.
          </p>
        </div>

      </div>
    </div>
  );
}
