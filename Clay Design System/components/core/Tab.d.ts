import * as React from "react";

export interface TabItem {
  label: string;
  value: string;
}

export interface TabProps {
  /** Tabs as strings or {label, value} objects. */
  items: (string | TabItem)[];
  /** Active tab value. */
  value: string;
  /** Called with the new value. */
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
}

/** Pill-shaped category sub-nav; active tab fills cream-card. */
export function Tab(props: TabProps): JSX.Element;
