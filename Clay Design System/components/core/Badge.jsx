import React from "react";

/**
 * Clay badge / pill label. Default = cream-fill caption pill.
 * Tones map to the brand palette for category accents.
 */
export function Badge({ tone = "cream", uppercase = false, children, style = {}, ...rest }) {
  const tones = {
    cream: { background: "var(--color-surface-card)", color: "var(--color-ink)" },
    pink: { background: "var(--color-brand-pink)", color: "var(--color-on-primary)" },
    teal: { background: "var(--color-brand-teal)", color: "var(--color-on-dark)" },
    lavender: { background: "var(--color-brand-lavender)", color: "var(--color-ink)" },
    peach: { background: "var(--color-brand-peach)", color: "var(--color-ink)" },
    ochre: { background: "var(--color-brand-ochre)", color: "var(--color-ink)" },
    success: { background: "rgba(34,197,94,.16)", color: "#137a3b" },
    warning: { background: "rgba(245,158,11,.16)", color: "#9a6206" },
    error: { background: "rgba(239,68,68,.14)", color: "#b3261e" },
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: uppercase ? "5px 12px" : "4px 12px",
        borderRadius: "var(--radius-pill)",
        font: uppercase ? "var(--text-caption-uppercase)" : "var(--text-caption)",
        letterSpacing: uppercase ? "var(--tracking-caption-uppercase)" : "0",
        textTransform: uppercase ? "uppercase" : "none",
        whiteSpace: "nowrap",
        ...(tones[tone] || tones.cream),
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
