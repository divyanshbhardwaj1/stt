import React from "react";

/**
 * Clay avatar — circular, used in testimonials and expert cards.
 * Shows an image when `src` is set, else initials on a brand-tinted fill.
 */
export function Avatar({ src, name = "", size = 40, tone = "lavender", style = {} }) {
  const tones = {
    lavender: { background: "var(--color-brand-lavender)", color: "var(--color-ink)" },
    peach: { background: "var(--color-brand-peach)", color: "var(--color-ink)" },
    mint: { background: "var(--color-brand-mint)", color: "var(--color-ink)" },
    ochre: { background: "var(--color-brand-ochre)", color: "var(--color-ink)" },
    teal: { background: "var(--color-brand-teal)", color: "var(--color-on-dark)" },
  };
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const dim = { width: size, height: size, borderRadius: "var(--radius-full)", flex: "none" };

  if (src) {
    return <img src={src} alt={name} style={{ ...dim, objectFit: "cover", ...style }} />;
  }
  return (
    <div
      style={{
        ...dim,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: "var(--text-title-sm)",
        fontSize: Math.round(size * 0.38),
        ...(tones[tone] || tones.lavender),
        ...style,
      }}
    >
      {initials}
    </div>
  );
}
