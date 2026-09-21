import * as React from "react";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "style"> {
  /** Field label rendered above the input. */
  label?: string;
  /** Helper text below the field. */
  hint?: string;
  /** Error message — turns border + text red, overrides hint. */
  error?: string;
  /** Input type. @default "text" */
  type?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

/** Clay text input — cream fill, hairline border, focuses to ink. */
export function Input(props: InputProps): JSX.Element;
