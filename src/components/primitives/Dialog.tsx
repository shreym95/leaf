"use client";

import { forwardRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import clsx from "clsx";

/**
 * Dialog — token-driven wrapper over @radix-ui/react-dialog (a11y: focus trap,
 * Esc-to-close, scroll lock). Presentational only.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={clsx(
        "fixed inset-0 z-40 [background:var(--leaf-gutter)]",
        "transition-opacity [transition-duration:var(--leaf-dur-ui)]",
        className,
      )}
      {...props}
    />
  );
});

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Accessible title. Required by Radix; pass `hideTitle` to visually hide it. */
  title: string;
  hideTitle?: boolean;
  description?: string;
}

export const DialogContent = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogContent(
  { title, hideTitle = false, description, className, children, ...props },
  ref,
) {
  return (
    <DialogPortal>
      <DialogOverlay />
      {/* Positioning wrapper keeps Content styling token-only; padding area
          still counts as "outside" for Radix's dismiss handling. */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <DialogPrimitive.Content
          ref={ref}
          className={clsx(
            "w-full max-w-md bg-page text-ink border border-rule rounded-lg p-6",
            "[box-shadow:var(--leaf-shadow-sheet)] focus-visible:outline-none",
            className,
          )}
          {...props}
        >
          {hideTitle ? (
            <VisuallyHidden asChild>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            </VisuallyHidden>
          ) : (
            <DialogPrimitive.Title className="font-display text-ink [font-size:var(--leaf-text-xl)]">
              {title}
            </DialogPrimitive.Title>
          )}
          {description ? (
            <DialogPrimitive.Description className="mt-2 font-body text-ink-mid [font-size:var(--leaf-text-sm)]">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          <div className="mt-4">{children}</div>
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  );
});
