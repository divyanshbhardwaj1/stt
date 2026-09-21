const { Button: HBtn, Badge: HBadge, FeatureCard, Card, Avatar } = window.ClayDesignSystem_d1a48f;

const homeWrap = { maxWidth: "var(--container-max)", margin: "0 auto", padding: "0 32px" };

// ── product-UI fragments shown inside feature cards ───────────────
function EnrichFrag() {
  const rows = [["Acme Inc", "Verified"], ["Lumen Co", "Verified"], ["Northwind", "Enriching…"]];
  return (
    <div style={{ background: "rgba(255,255,255,.92)", borderRadius: "var(--radius-md)", padding: 12, color: "var(--color-ink)" }}>
      {rows.map(([a, b], i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 4px", borderBottom: i < 2 ? "1px solid var(--color-hairline)" : "none" }}>
          <span style={{ font: "var(--text-body-sm)" }}>{a}</span>
          <span style={{ font: "var(--text-caption)", color: b === "Verified" ? "var(--color-success)" : "var(--color-muted)" }}>{b}</span>
        </div>
      ))}
    </div>
  );
}
function AgentFrag() {
  return (
    <div style={{ background: "rgba(255,255,255,.14)", borderRadius: "var(--radius-md)", padding: 14, font: "var(--text-body-sm)", lineHeight: 1.7 }}>
      <div style={{ opacity: .7 }}>→ Researching funding rounds…</div>
      <div style={{ opacity: .85 }}>→ Found Series B · $40M</div>
      <div>✓ Wrote to column "Stage"</div>
    </div>
  );
}
function SeqFrag() {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {["Email", "Wait 2d", "LinkedIn"].map((s, i) => (
        <React.Fragment key={s}>
          <div style={{ background: "rgba(255,255,255,.92)", color: "var(--color-ink)", font: "var(--text-caption)", padding: "8px 12px", borderRadius: "var(--radius-pill)" }}>{s}</div>
          {i < 2 && <span style={{ opacity: .6 }}>→</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

function Hero() {
  return (
    <section style={{ ...homeWrap, paddingTop: 72, paddingBottom: 96 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 56, alignItems: "center" }}>
        <div>
          <HBadge uppercase>GTM data platform</HBadge>
          <h1 style={{ font: "var(--text-display-xl)", letterSpacing: "var(--tracking-display-xl)", margin: "20px 0 0", textWrap: "balance" }}>
            Go to market with unique data
          </h1>
          <p style={{ font: "var(--text-title-md)", fontWeight: 400, color: "var(--color-body)", maxWidth: 460, margin: "24px 0 0", textWrap: "pretty" }}>
            Pull from 100+ providers, run AI research agents, and push clean records straight into your sequences and CRM.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 32 }}>
            <HBtn size="lg">Try free</HBtn>
            <HBtn size="lg" variant="secondary">Book a demo</HBtn>
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 40, alignItems: "center", font: "var(--text-caption)", color: "var(--color-muted)" }}>
            <span>Trusted by 8,000+ teams</span>
            <span style={{ display: "flex", gap: 14, opacity: .7 }}>
              {["Ramp", "Vanta", "OpenAI", "Notion"].map((b) => <strong key={b} style={{ fontWeight: 600 }}>{b}</strong>)}
            </span>
          </div>
        </div>
        <window.ClayIllustration height={400} blobs={["pink", "ochre", "lavender", "mint"]} />
      </div>
    </section>
  );
}

function FeatureSection() {
  return (
    <section style={{ background: "var(--color-surface-soft)" }}>
      <div style={{ ...homeWrap, paddingTop: 96, paddingBottom: 96 }}>
        <div style={{ maxWidth: 620, marginBottom: 48 }}>
          <HBadge uppercase>The platform</HBadge>
          <h2 style={{ font: "var(--text-display-lg)", letterSpacing: "var(--tracking-display-lg)", margin: "16px 0 0" }}>Everything your GTM data needs</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          <FeatureCard color="pink" eyebrow="Sequences" title="Run outbound in one click" description="Push enriched records into multi-step plays.">
            <SeqFrag />
          </FeatureCard>
          <FeatureCard color="lavender" eyebrow="Claygent" title="AI research agents" description="Agents find what static data can't.">
            <AgentFrag />
          </FeatureCard>
          <FeatureCard color="peach" eyebrow="Enrichment" title="Waterfall across 100+ sources" description="Always get the best available record.">
            <EnrichFrag />
          </FeatureCard>
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  const data = [
    { q: "Clay replaced five tools and cut our research time by 80%.", n: "Mei Lin", r: "Head of Growth, Ramp", t: "lavender" },
    { q: "We build lists in minutes that used to take an analyst a week.", n: "Devon Rao", r: "RevOps Lead, Vanta", t: "peach" },
    { q: "Claygent is the first AI that actually does the boring work.", n: "Sara Kade", r: "Founder, Northwind", t: "mint" },
  ];
  return (
    <section style={{ ...homeWrap, paddingTop: 96, paddingBottom: 96 }}>
      <h2 style={{ font: "var(--text-display-md)", letterSpacing: "var(--tracking-display-md)", margin: "0 0 40px", maxWidth: 520 }}>Loved by revenue teams</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {data.map((d) => (
          <Card key={d.n} variant="cream" padding="28px">
            <p style={{ font: "var(--text-title-md)", fontWeight: 500, margin: "0 0 24px", textWrap: "pretty" }}>"{d.q}"</p>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Avatar name={d.n} tone={d.t} />
              <div>
                <div style={{ font: "var(--text-title-sm)" }}>{d.n}</div>
                <div style={{ font: "var(--text-body-sm)", color: "var(--color-muted)" }}>{d.r}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function CtaBand() {
  return (
    <section style={{ ...homeWrap, paddingBottom: 96 }}>
      <Card variant="soft" radius="var(--radius-xl)" padding="0">
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", alignItems: "center", gap: 32, padding: 64 }}>
          <div>
            <h2 style={{ font: "var(--text-display-md)", letterSpacing: "var(--tracking-display-md)", margin: 0, textWrap: "balance" }}>
              Turn your growth ideas into reality today
            </h2>
            <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
              <HBtn size="lg">Try free</HBtn>
              <HBtn size="lg" variant="secondary">Talk to sales</HBtn>
            </div>
          </div>
          <window.ClayIllustration height={200} blobs={["coral", "ochre", "mint", "lavender"]} label="Mascot scene" />
        </div>
      </Card>
    </section>
  );
}

function Home() {
  return (
    <>
      <Hero />
      <FeatureSection />
      <Testimonials />
      <CtaBand />
    </>
  );
}

window.Home = Home;
