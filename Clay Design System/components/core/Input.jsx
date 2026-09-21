import React from "react";

/**
 * Clay text input — cream fill, 1px hairline, 12px radius, 44px tall.
 * Border thickens to ink on focus.
 */
export function Input({
  label,
  hint,
  error,
  type = "text",
  disabled = false,
  style = {},
  id,
  ...rest
}) {
  const [focused, setFocused] = React.useState(false);
  const inputId = id || (label ? `in-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  const borderColor = error
    ? "var(--color-error)"
    : focused
    ? "var(--color-ink)"
    : "var(--color-hairline)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", ...style }}>
      {label && (
        <label htmlFor={inputId} style={{ font: "var(--text-caption)", color: "var(--color-body-strong)" }}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        type={type}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          height: "44px",
          padding: "0 16px",
          font: "var(--text-body-md)",
          color: "var(--color-ink)",
          background: disabled ? "var(--color-surface-card)" : "var(--color-canvas)",
          border: `1px solid ${borderColor}`,
          borderRadius: "var(--radius-md)",
          outline: "none",
          boxSizing: "border-box",
          transition: "border-color .15s ease",
        }}
        {...rest}
      />
      {(hint || error) && (
        <span style={{ font: "var(--text-caption)", color: error ? "var(--color-error)" : "var(--color-muted)" }}>
          {error || hint}
        </span>
      )}
    </div>
  );
}
