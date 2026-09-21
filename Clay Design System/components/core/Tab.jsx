import React from "react";

/**
 * Clay category tabs — pill-shaped sub-nav. Active tab gets a cream-card
 * fill + ink text; inactive tabs are transparent + muted.
 */
export function Tab({ items = [], value, onChange = () => {}, style = {} }) {
  return (
    <div style={{ display: "inline-flex", gap: "4px", flexWrap: "wrap", ...style }}>
      {items.map((it) => {
        const key = typeof it === "string" ? it : it.value;
        const label = typeof it === "string" ? it : it.label;
        const active = key === value;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              padding: "8px 16px",
              borderRadius: "var(--radius-pill)",
              border: "none",
              cursor: "pointer",
              font: "var(--text-nav-link)",
              background: active ? "var(--color-surface-card)" : "transparent",
              color: active ? "var(--color-ink)" : "var(--color-muted)",
              transition: "background-color .15s ease, color .15s ease",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
