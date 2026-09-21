const { Badge: FooterBadge } = window.ClayDesignSystem_d1a48f;

function Footer() {
  const cols = [
    { h: "Product", items: ["Tables", "Claygent", "Sequences", "Integrations", "Pricing"] },
    { h: "Solutions", items: ["Sales", "Marketing", "RevOps", "Recruiting", "Startups"] },
    { h: "Resources", items: ["Blog", "University", "Templates", "Community", "Docs"] },
    { h: "Company", items: ["About", "Careers", "Customers", "Experts", "Contact"] },
  ];
  return (
    <footer style={{ background: "var(--color-surface-soft)", borderTop: "1px solid var(--color-hairline-soft)" }}>
      <div style={{ maxWidth: "var(--container-max)", margin: "0 auto", padding: "80px 32px 32px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr", gap: 32 }}>
          <div>
            <window.Logo />
            <p style={{ font: "var(--text-body-sm)", color: "var(--color-muted)", maxWidth: 240, marginTop: 16 }}>
              Go to market with unique data and AI. Built for revenue teams.
            </p>
          </div>
          {cols.map((c) => (
            <div key={c.h}>
              <div style={{ font: "var(--text-title-sm)", marginBottom: 14 }}>{c.h}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {c.items.map((i) => (
                  <a key={i} style={{ cursor: "pointer", font: "var(--text-body-sm)", color: "var(--color-muted)" }}>{i}</a>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* signature horizon mountain — placeholder */}
        <div style={{
          marginTop: 56, height: 120, borderRadius: "var(--radius-lg)",
          background: "linear-gradient(180deg, transparent, color-mix(in srgb, var(--color-brand-peach) 35%, var(--color-surface-soft)))",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", bottom: -40, left: "8%", width: 180, height: 180, borderRadius: "50% 50% 0 0 / 100% 100% 0 0", background: "color-mix(in srgb, var(--color-brand-ochre) 60%, var(--color-surface-strong))" }} />
          <div style={{ position: "absolute", bottom: -60, left: "34%", width: 240, height: 220, borderRadius: "50% 50% 0 0 / 100% 100% 0 0", background: "color-mix(in srgb, var(--color-brand-teal) 22%, var(--color-surface-strong))" }} />
          <div style={{ position: "absolute", bottom: -40, right: "10%", width: 160, height: 150, borderRadius: "50% 50% 0 0 / 100% 100% 0 0", background: "color-mix(in srgb, var(--color-brand-coral) 30%, var(--color-surface-strong))" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 12, textAlign: "center", font: "var(--text-caption)", color: "var(--color-muted-soft)" }}>Signature footer mountain — illustration placeholder</div>
        </div>
        <div style={{
          marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--color-hairline)",
          display: "flex", justifyContent: "space-between", font: "var(--text-body-sm)", color: "var(--color-muted)",
        }}>
          <span>© 2026 Clay Labs, Inc.</span>
          <span style={{ display: "flex", gap: 20 }}><a style={{cursor:"pointer",color:"inherit"}}>Privacy</a><a style={{cursor:"pointer",color:"inherit"}}>Terms</a><a style={{cursor:"pointer",color:"inherit"}}>Security</a></span>
        </div>
      </div>
    </footer>
  );
}

window.Footer = Footer;
