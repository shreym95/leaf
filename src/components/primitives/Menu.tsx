"use client";

import { forwardRef } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import clsx from "clsx";

/**
 * Menu — token-driven wrapper over @radix-ui/react-dropdown-menu (a11y: roving
 * focus, typeahead, Esc-to-close). Presentational only.
 */

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuGroup = DropdownMenu.Group;
export const MenuSeparator = forwardRef<
  React.ComponentRef<typeof DropdownMenu.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Separator>
>(function MenuSeparator({ className, ...props }, ref) {
  return (
    <DropdownMenu.Separator
      ref={ref}
      className={clsx("my-1 h-px bg-rule", className)}
      {...props}
    />
  );
});

export const MenuContent = forwardRef<
  React.ComponentRef<typeof DropdownMenu.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Content>
>(function MenuContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        ref={ref}
        sideOffset={sideOffset}
        style={{ boxShadow: "var(--leaf-shadow-sheet)" }}
        className={clsx(
          "z-50 min-w-40 bg-page text-ink border border-rule rounded-md p-1",
          className,
        )}
        {...props}
      />
    </DropdownMenu.Portal>
  );
});

export const MenuItem = forwardRef<
  React.ComponentRef<typeof DropdownMenu.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Item>
>(function MenuItem({ className, ...props }, ref) {
  return (
    <DropdownMenu.Item
      ref={ref}
      className={clsx(
        "flex cursor-pointer select-none items-center rounded-xs px-3 py-2 outline-none",
        "font-ui text-ink [font-size:var(--leaf-text-sm)]",
        "data-[highlighted]:bg-edge data-[disabled]:opacity-40 data-[disabled]:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
});
