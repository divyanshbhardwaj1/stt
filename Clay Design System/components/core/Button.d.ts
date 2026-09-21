import * as React from "react";

/**
 * Clay primary CTA and its variants. Near-black fill, 12px radius, 44px tall.
 * @startingPoint section="Core" subtitle="Primary CTA + variants" viewport="700x150"
 */
export interface ButtonProps extends React.HTMLAttributes<HTMLElement> {
  /** Visual style. @default "primary" */
  variant?: "primary" | "secondary" | "on-color" | "text";
  /** Control height. @default "md" */
  size?: "sm" | "md" | "lg";
  /** Disabled (primary only renders disabled fill). */
  disabled?: boolean;
  /** Optional leading icon node. */
  iconLeft?: React.ReactNode;
  /** Optional trailing icon node. */
  iconRight?: React.ReactNode;
  /** Render as an anchor with this href. */
  href?: string;
  children?: React.ReactNode;
}

export function Button(props: ButtonProps): JSX.Element;
