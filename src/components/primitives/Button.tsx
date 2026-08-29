import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import clsx from "clsx";

/**
 * Button — the one interactive primitive. Presentational only: props in, markup out.
 * Every visual value is a token (mapped utility or `var(--leaf-*)`), never a literal.
 */

export type ButtonVariant = "primary" | "ghost" | "quiet";
export type ButtonSize = "sm" | "md";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Mono-uppercase treatment for the reader chrome bar (see approved v0.1). */
  mono?: boolean;
  /** Render as the single child element (Radix Slot) instead of a <button>. */
  asChild?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 font-body rounded-sm select-none " +
  "transition-colors [transition-duration:var(--leaf-dur-ui)] " +
  "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)] " +
  "disabled:opacity-40 disabled:pointer-events-none";

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 [font-size:var(--leaf-text-xs)]",
  md: "h-10 px-4 [font-size:var(--leaf-text-sm)]",
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "[background:var(--leaf-accent)] [color:var(--leaf-page)] hover:opacity-90",
  ghost: "border border-rule text-ink hover:bg-edge",
  quiet: "text-ink-mid hover:text-ink",
};

const monoClass =
  "font-mono font-medium uppercase [letter-spacing:var(--leaf-tracking-wide)]";

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    mono = false,
    asChild = false,
    className,
    type,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      className={clsx(
        base,
        sizes[size],
        variants[variant],
        mono && monoClass,
        className,
      )}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
});
