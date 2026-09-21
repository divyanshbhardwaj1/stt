import React from "react";

/**
 * Clay Button — near-black primary CTA with friendly 12px radius.
 * Variants: primary (default), secondary (cream + hairline), on-color
 * (white, for use over saturated feature cards), text (inline link).
 */
export function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  iconLeft = null,
  iconRight = null,
  href,
  children,
  style = {},
  ...rest
}) {
  const sizes = {
    sm: { height: 36, padding: "0 14px", font: "var(--text-button)" },
    md: { height: 44, padding: "0 20px", font: "var(--text-button)" },
    lg: { height: 52, padding: "0 28px", font: "var(--text-title-sm)" },
  };
  const sz = sizes[size] || sizes.md;

  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    height: sz.height,
    padding: sz.padding,
    font: sz.font,
    borderRadius: "var(--radius-md)",
    border: "1px solid transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    textDecoration: "none",
    whiteSpace: "nowrap",
    transition: "background-color .15s ease, color .15s ease",
    boxSizing: "border-box",
  };

  const variants = {
    primary: {
      background: disabled ? "var(--color-primary-disabled)" : "var(--color-primary)",
      color: disabled ? "var(--color-muted)" : "var(--color-on-primary)",
    },
    secondary: {
      background: "var(--color-canvas)",
      color: disabled ? "var(--color-muted)" : "var(--color-ink)",
      borderColor: "var(--color-hairline)",
    },
    "on-color": {
      background: "var(--color-canvas)",
      color: "var(--color-ink)",
    },
    text: {
      background: "transparent",
      color: disabled ? "var(--color-muted)" : "var(--color-ink)",
      height: "auto",
      padding: 0,
      borderRadius: 0,
    },
  };

  const cssStyle = { ...base, ...(variants[variant] || variants.primary), ...style };
  const Tag = href && !disabled ? "a" : "button";

  return (
    <Tag
      href={href}
      disabled={Tag === "button" ? disabled : undefined}
      style={cssStyle}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </Tag>
  );
}
