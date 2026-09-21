const { Button: SBtn, Input: SInput, Card: SCard, Badge: SBadge } = window.ClayDesignSystem_d1a48f;

function SignIn({ onNav }) {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  return (
    <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: "calc(100vh - 64px)", alignItems: "center", gap: 64, maxWidth: "var(--container-max)", margin: "0 auto", padding: "64px 32px" }}>
      <div style={{ maxWidth: 400 }}>
        <h1 style={{ font: "var(--text-display-md)", letterSpacing: "var(--tracking-display-md)", margin: 0 }}>
          {sent ? "Check your inbox" : "Sign in to Clay"}
        </h1>
        {sent ? (
          <p style={{ font: "var(--text-body-md)", color: "var(--color-body)", margin: "16px 0 32px" }}>
            We sent a magic link to <strong style={{ color: "var(--color-ink)" }}>{email || "you@company.com"}</strong>.
          </p>
        ) : (
          <>
            <p style={{ font: "var(--text-body-md)", color: "var(--color-body)", margin: "16px 0 32px" }}>
              Use your work email — no password needed.
            </p>
            <div style={{ display: "grid", gap: 16 }}>
              <SInput label="Work email" placeholder="you@company.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <SBtn size="lg" onClick={() => setSent(true)}>Continue</SBtn>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0" }}>
              <div style={{ height: 1, background: "var(--color-hairline)", flex: 1 }} />
              <span style={{ font: "var(--text-caption)", color: "var(--color-muted-soft)" }}>or</span>
              <div style={{ height: 1, background: "var(--color-hairline)", flex: 1 }} />
            </div>
            <SBtn variant="secondary" size="lg" style={{ width: "100%" }}>Continue with Google</SBtn>
          </>
        )}
        <p style={{ font: "var(--text-body-sm)", color: "var(--color-muted)", marginTop: 32 }}>
          New to Clay? <a onClick={() => onNav && onNav("home")} style={{ color: "var(--color-ink)", cursor: "pointer", textDecoration: "underline" }}>Try it free</a>
        </p>
      </div>
      <SCard variant="cream" radius="var(--radius-xl)" padding="40px">
        <SBadge uppercase>Why teams switch</SBadge>
        <p style={{ font: "var(--text-title-lg)", letterSpacing: "var(--tracking-title-lg)", margin: "20px 0 28px", textWrap: "pretty" }}>
          "Clay replaced five tools and cut our research time by 80%."
        </p>
        <div style={{ font: "var(--text-body-sm)", color: "var(--color-muted)" }}>Mei Lin · Head of Growth, Ramp</div>
      </SCard>
    </section>
  );
}

window.SignIn = SignIn;
