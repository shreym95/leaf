"use client";

import { forwardRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import clsx from "clsx";

/**
 * Sheet — a bottom sheet (mobile reading-settings pattern, SPEC §8). Built on
 * @radix-ui/react-dialog so it inherits the focus trap / Esc / scroll lock, then
 * styled to slide up from the bottom edge. Presentational only.
 */

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function SheetOverlay({ className, ...props }, ref) {
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

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  title: string;
  hideTitle?: boolean;
}

export const SheetContent = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function SheetContent(
  { title, hideTitle = false, className, children, ...props },
  ref,
) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center">
        <DialogPrimitive.Content
          ref={ref}
          style={{
            borderTopLeftRadius: "var(--leaf-radius-lg)",
            borderTopRightRadius: "var(--leaf-radius-lg)",
            boxShadow: "var(--leaf-shadow-sheet)",
          }}
          className={clsx(
            "w-full max-w-lg bg-page text-ink border border-rule border-b-0 p-6 pb-8",
            "focus-visible:outline-none",
            className,
          )}
          {...props}
        >
          <div
            aria-hidden
            className="mx-auto mb-4 h-1 w-10 rounded-sm bg-rule"
          />
          {hideTitle ? (
            <VisuallyHidden asChild>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            </VisuallyHidden>
          ) : (
            <DialogPrimitive.Title className="font-mono uppercase text-faint [letter-spacing:var(--leaf-tracking-label)] [font-size:var(--leaf-text-2xs)]">
              {title}
            </DialogPrimitive.Title>
          )}
          <div className="mt-4">{children}</div>
        </DialogPrimitive.Content>
      </div>
    </SheetPortal>
  );
});
