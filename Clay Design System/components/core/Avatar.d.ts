import * as React from "react";

export interface AvatarProps {
  /** Image URL. When omitted, renders initials. */
  src?: string;
  /** Full name — drives alt text and initials fallback. */
  name?: string;
  /** Pixel diameter. @default 40 */
  size?: number;
  /** Fallback fill tone. @default "lavender" */
  tone?: "lavender" | "peach" | "mint" | "ochre" | "teal";
  style?: React.CSSProperties;
}

/** Circular avatar with brand-tinted initials fallback. */
export function Avatar(props: AvatarProps): JSX.Element;
