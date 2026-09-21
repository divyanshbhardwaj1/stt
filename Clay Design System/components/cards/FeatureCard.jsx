import React from "react";

/**
 * Clay saturated feature card — the brand's signature voltage element.
 * One of 6 fills (pink, teal, lavender, peach, ochre, cream), 24px radius,
 * 32px padding. Text auto-flips to white on pink/teal. `children` holds a
 * product-UI fragment or illustration shown below the copy.
 */
export function FeatureCard({
  color = "pink",
  eyebrow,
  title,
  description,
  children,
  style = {},
  ...rest
}) {
  const fills = {
    pink: { background: "var(--color-brand-pink)", dark: false },
    teal: { background: "var(--color-brand-teal)", dark: true },
    lavender: { background: "var(--color-brand-lavender)", dark: false },
    peach: { background: "var(--color-brand-peach)", dark: false },
    ochre: { background: "var(--color-brand-ochre)", dark: false },
    cream: { background: "var(--color-surface-card)", dark: false },
  };
  const f = fills[color] || fills.pink;
  // pink + teal carry white text; lighter fills keep dark ink
  const onColor = color === "pink" || color === "teal";
  const ink = onColor ? "var(--color-on-primary)" : "var(--color-ink)";
  const sub = onColor ? "rgba(255,255,255,.82)" : "var(--color-body)";
  const eye = onColor ? "rgba(255,255,255,.7)" : "var(--color-muted)";

  return (
    <div
      style={{
        background: f.background,
        color: ink,
        borderRadius: "var(--radius-xl)",
        padding: "var(--space-xl)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-md)",
        boxSizing: "border-box",
        ...style,
      }}
      {...rest}
    >
      {eyebrow && (
        <span
          style={{
            font: "var(--text-caption-uppercase)",
            letterSpacing: "var(--tracking-caption-uppercase)",
            textTransform: "uppercase",
            color: eye,
          }}
        >
          {eyebrow}
        </span>
      )}
      {title && (
        <h3 style={{ margin: 0, font: "var(--text-title-lg)", letterSpacing: "var(--tracking-title-lg)", color: ink }}>
          {title}
        </h3>
      )}
      {description && (
        <p style={{ margin: 0, font: "var(--text-body-md)", color: sub, textWrap: "pretty" }}>{description}</p>
      )}
      {children && <div style={{ marginTop: "var(--space-xs)" }}>{children}</div>}
    </div>
  );
}
