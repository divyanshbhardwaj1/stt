const { Button: EBtn, Badge: EBadge, Card: ECard, Tab: ETab, Avatar: EAvatar } = window.ClayDesignSystem_d1a48f;

const expertsWrap = { maxWidth: "var(--container-max)", margin: "0 auto", padding: "0 32px" };

const EXPERTS = [
  { n: "Mei Lin", s: "Outbound sequences", t: "lavender", r: "$180/hr", loc: "San Francisco" },
  { n: "Devon Rao", s: "Claygent & AI research", t: "peach", r: "$150/hr", loc: "Austin" },
  { n: "Sara Kade", s: "CRM enrichment", t: "mint", r: "$165/hr", loc: "Berlin" },
  { n: "Theo Vance", s: "RevOps architecture", t: "ochre", r: "$210/hr", loc: "London" },
  { n: "Priya Nair", s: "Inbound routing", t: "pink", r: "$140/hr", loc: "Bangalore" },
  { n: "Jonas Alt", s: "Data waterfalls", t: "teal", r: "$175/hr", loc: "Toronto" },
];

function ExpertCard({ e }) {
  return (
    <ECard padding="24px">
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <EAvatar name={e.n} tone={e.t} size={44} />
        <div>
          <div style={{ font: "var(--text-title-sm)" }}>{e.n}</div>
          <div style={{ font: "var(--text-body-sm)", color: "var(--color-muted)" }}>{e.loc}</div>
        </div>
      </div>
      <div style={{ marginTop: 20 }}><EBadge>{e.s}</EBadge></div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 24 }}>
        <span style={{ font: "var(--text-body-sm)", color: "var(--color-muted)" }}>{e.r}</span>
        <EBtn variant="secondary" size="sm">Book session</EBtn>
      </div>
    </ECard>
  );
}

function Experts() {
  const [tab, setTab] = React.useState("All");
  return (
    <>
      <section style={{ ...expertsWrap, paddingTop: 72, paddingBottom: 48 }}>
        <EBadge uppercase>Clay experts</EBadge>
        <h1 style={{ font: "var(--text-display-lg)", letterSpacing: "var(--tracking-display-lg)", margin: "16px 0 0", maxWidth: 640, textWrap: "balance" }}>
          Work with an expert who has built it before
        </h1>
        <p style={{ font: "var(--text-title-md)", fontWeight: 400, color: "var(--color-body)", maxWidth: 520, margin: "20px 0 0" }}>
          Vetted operators who set up tables, agents, and sequences for teams like yours.
        </p>
        <div style={{ marginTop: 32 }}>
          <ETab items={["All", "Outbound", "AI agents", "RevOps"]} value={tab} onChange={setTab} />
        </div>
      </section>
      <section style={{ ...expertsWrap, paddingBottom: 96 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {EXPERTS.map((e) => <ExpertCard key={e.n} e={e} />)}
        </div>
      </section>
      <section style={{ ...expertsWrap, paddingBottom: 96 }}>
        <ECard variant="soft" radius="var(--radius-xl)" padding="0">
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", alignItems: "center", gap: 32, padding: 64 }}>
            <div>
              <h2 style={{ font: "var(--text-display-md)", letterSpacing: "var(--tracking-display-md)", margin: 0, textWrap: "balance" }}>
                Become a Clay expert
              </h2>
              <p style={{ font: "var(--text-body-md)", color: "var(--color-body)", margin: "16px 0 0", maxWidth: 420 }}>
                Get matched with teams that need your playbooks.
              </p>
              <div style={{ marginTop: 28 }}><EBtn size="lg">Apply now</EBtn></div>
            </div>
            <window.ClayIllustration height={200} blobs={["ochre", "mint", "coral", "lavender"]} label="Expert scene" />
          </div>
        </ECard>
      </section>
    </>
  );
}

window.Experts = Experts;
