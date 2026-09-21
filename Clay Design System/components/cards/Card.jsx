import React from "react";

/**
 * Clay content card — quieter container for product mockups, testimonials,
 * pricing tiers, and expert cards. No saturated color; relies on hairline
 * or cream fill. For the bright brand cards use FeatureCard instead.
 */
export function Card({ variant = "plain", padding, radius, children, style = {}, ...rest }) {
  const variants = {
    // canvas + hairline — product mockups, pricing tiers, expert cards
    plain: { background: "var(--color-canvas)", border: "1px solid var(--color-hairline)", color: "var(--color-ink)" },
    // cream fill, no border — testimonials, secondary cards
    cream: { background: "var(--color-surface-card)", border: "1px solid transparent", color: "var(--color-ink)" },
    // deep teal — featured pricing tier
    featured: { background: "var(--color-brand-teal)", border: "1px solid transparent", color: "var(--color-on-dark)" },
    // soft cream band — CTA / hero-illustration surfaces
    soft: { background: "var(--color-surface-soft)", border: "1px solid transparent", color: "var(--color-ink)" },
  };
  const v = variants[variant] || variants.plain;
  return (
    <div
      style={{
        ...v,
        borderRadius: radius || "var(--radius-lg)",
        padding: padding || "var(--space-lg)",
        boxSizing: "border-box",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
