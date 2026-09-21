import * as React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Surface treatment. @default "plain" */
  variant?: "plain" | "cream" | "featured" | "soft";
  /** Override padding (CSS value). @default var(--space-lg) */
  padding?: string;
  /** Override border-radius (CSS value). @default var(--radius-lg) */
  radius?: string;
  children?: React.ReactNode;
}

/** Quiet content card — mockups, testimonials, pricing tiers, CTA surfaces. */
export function Card(props: CardProps): JSX.Element;
