// Clay marketing-site nav + shared bits. Exports to window for the kit.
const { Button, Badge } = window.ClayDesignSystem_d1a48f;

function Logo() {
  return (
    // No logo asset was supplied — the wordmark is set in plain display type.
    <span style={{ font: "var(--text-title-lg)", fontWeight: 500, letterSpacing: "-0.04em" }}>Clay</span>
  );
}

function Nav({ page, onNav }) {
  const links = ["Product", "Solutions", "Experts", "Pricing", "Customers"];
  return (
    <nav style={{
      position: "sticky", top: 0, zIndex: 20, height: 64,
      background: "color-mix(in srgb, var(--color-canvas) 88%, transparent)",
      backdropFilter: "blur(8px)",
      borderBottom: "1px solid var(--color-hairline-soft)",
      display: "flex", alignItems: "center",
    }}>
      <div style={{
        maxWidth: "var(--container-max)", width: "100%", margin: "0 auto",
        padding: "0 32px", display: "flex", alignItems: "center", gap: 32,
      }}>
        <a onClick={() => onNav("home")} style={{ cursor: "pointer", textDecoration: "none" }}><Logo /></a>
        <div style={{ display: "flex", gap: 4, flex: 1 }}>
          {links.map((l) => {
            const target = l.toLowerCase();
            const active = page === target;
            return (
              <a key={l} onClick={() => onNav(target)} style={{
                cursor: "pointer", padding: "8px 12px", borderRadius: "var(--radius-sm)",
                font: "var(--text-nav-link)", color: active ? "var(--color-ink)" : "var(--color-muted)",
              }}>{l}</a>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <a onClick={() => onNav("signin")} style={{ cursor: "pointer", font: "var(--text-nav-link)", color: "var(--color-ink)" }}>Sign in</a>
          <Button>Try free</Button>
        </div>
      </div>
    </nav>
  );
}

// Cream illustration placeholder — stands in for Clay's commissioned 3D
// claymation art (not provided with the brief). Soft clay blobs + label.
function ClayIllustration({ height = 360, blobs = ["pink", "ochre", "lavender", "mint"], label = "3D claymation illustration" }) {
  const colorVar = (c) => `var(--color-brand-${c})`;
  return (
    <div style={{
      position: "relative", height, borderRadius: "var(--radius-xl)",
      background: "var(--color-surface-soft)", overflow: "hidden",
      border: "1px solid var(--color-hairline-soft)",
    }}>
      <div style={{ position: "absolute", width: 150, height: 150, borderRadius: "50%", background: colorVar(blobs[0]), top: "12%", left: "10%", filter: "blur(2px)" }} />
      <div style={{ position: "absolute", width: 120, height: 120, borderRadius: "50%", background: colorVar(blobs[1]), bottom: "14%", left: "32%" }} />
      <div style={{ position: "absolute", width: 170, height: 170, borderRadius: "46% 54% 50% 50% / 55% 50% 50% 45%", background: colorVar(blobs[2]), top: "20%", right: "12%" }} />
      <div style={{ position: "absolute", width: 90, height: 90, borderRadius: "50%", background: colorVar(blobs[3]), bottom: "10%", right: "26%" }} />
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 14, textAlign: "center",
        font: "var(--text-caption)", color: "var(--color-muted-soft)",
      }}>{label} — placeholder</div>
    </div>
  );
}

window.Logo = Logo;
window.Nav = Nav;
window.ClayIllustration = ClayIllustration;
