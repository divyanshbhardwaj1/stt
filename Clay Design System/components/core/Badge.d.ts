import * as React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Color tone. @default "cream" */
  tone?: "cream" | "pink" | "teal" | "lavender" | "peach" | "ochre" | "success" | "warning" | "error";
  /** Use the uppercase eyebrow style (12px, wide tracking). */
  uppercase?: boolean;
  children?: React.ReactNode;
}

/** Small pill label — cream by default, brand tones for category accents. */
export function Badge(props: BadgeProps): JSX.Element;
