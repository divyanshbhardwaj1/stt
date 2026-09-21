const { Button: PBtn, Badge: PBadge, Card: PCard, Tab: PTab } = window.ClayDesignSystem_d1a48f;

function Check({ on = "var(--color-ink)" }) {
  return <span style={{ color: on, font: "var(--text-title-sm)", lineHeight: 1 }}>✓</span>;
}

function PricingTier({ name, price, blurb, features, featured, cta }) {
  const ink = featured ? "var(--color-on-dark)" : "var(--color-ink)";
  const sub = featured ? "var(--color-on-dark-soft)" : "var(--color-muted)";
  return (
    <PCard variant={featured ? "featured" : "plain"} padding="32px" style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: featured ? 0 : 30 }}>
      {featured && <div><PBadge tone="ochre" uppercase>Most popular</PBadge></div>}
      <div>
        <div style={{ font: "var(--text-title-lg)", letterSpacing: "var(--tracking-title-lg)", color: ink }}>{name}</div>
        <div style={{ font: "var(--text-body-sm)", color: sub, marginTop: 6 }}>{blurb}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ font: "var(--text-display-md)", letterSpacing: "var(--tracking-display-md)", color: ink }}>{price}</span>
        {price !== "Custom" && <span style={{ font: "var(--text-body-sm)", color: sub }}>/ month</span>}
      </div>
      <PBtn variant={featured ? "on-color" : "primary"} style={{ width: "100%" }}>{cta}</PBtn>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
        {features.map((f) => (
          <div key={f} style={{ display: "flex", gap: 10, alignItems: "center", font: "var(--text-body-sm)", color: featured ? "var(--color-on-dark)" : "var(--color-body)" }}>
            <Check on={featured ? "var(--color-brand-mint)" : "var(--color-success)"} />{f}
          </div>
        ))}
      </div>
    </PCard>
  );
}

function Pricing() {
  const [cycle, setCycle] = React.useState("Monthly");
  const yearly = cycle === "Yearly";
  const tiers = [
    { name: "Starter", price: "$0", blurb: "For trying things out", cta: "Try free", features: ["1,200 credits / mo", "1 user", "10 data sources", "Community support"] },
    { name: "Explorer", price: yearly ? "$119" : "$149", blurb: "For individual operators", cta: "Start free trial", features: ["10,000 credits / mo", "Unlimited tables", "Claygent agents", "100+ data sources"] },
    { name: "Team", price: yearly ? "$279" : "$349", blurb: "For growing GTM teams", cta: "Start free trial", featured: true, features: ["50,000 credits / mo", "Roles & permissions", "CRM sync", "Priority support"] },
    { name: "Enterprise", price: "Custom", blurb: "For scaled orgs", cta: "Talk to sales", features: ["Custom credits", "SSO & SAML", "Audit logs", "Dedicated CSM"] },
  ];
  return (
    <section style={{ maxWidth: "var(--container-max)", margin: "0 auto", padding: "72px 32px 96px" }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <PBadge uppercase>Pricing</PBadge>
        <h1 style={{ font: "var(--text-display-lg)", letterSpacing: "var(--tracking-display-lg)", margin: "16px 0 0", textWrap: "balance" }}>Pricing that scales with you</h1>
        <p style={{ font: "var(--text-title-md)", fontWeight: 400, color: "var(--color-body)", margin: "16px auto 0", maxWidth: 480 }}>
          Start free. Pay for the credits you use as your team grows.
        </p>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
          <PTab items={["Monthly", "Yearly"]} value={cycle} onChange={setCycle} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, alignItems: "start" }}>
        {tiers.map((t) => <PricingTier key={t.name} {...t} />)}
      </div>
    </section>
  );
}

window.Pricing = Pricing;
