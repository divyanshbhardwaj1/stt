import * as React from "react";

/**
 * Saturated single-color feature card — Clay's signature page element.
 * @startingPoint section="Cards" subtitle="Saturated feature card" viewport="420x340"
 */
export interface FeatureCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Saturated fill. @default "pink" */
  color?: "pink" | "teal" | "lavender" | "peach" | "ochre" | "cream";
  /** Optional uppercase eyebrow above the title. */
  eyebrow?: string;
  /** Card heading. */
  title?: string;
  /** Supporting description. */
  description?: string;
  /** Product-UI fragment or illustration rendered below the copy. */
  children?: React.ReactNode;
}

export function FeatureCard(props: FeatureCardProps): JSX.Element;
