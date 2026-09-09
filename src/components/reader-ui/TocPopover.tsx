"use client";

import { useEffect, useRef } from "react";
import type { ReaderTocEntry } from "@/reader/engine";

/**
 * TocPopover — the chapter drawer above the dock's `≡` pod (design iteration 1).
 *
 * Structured as a tabbed panel whose tab bar renders ONLY when there is more
 * than one tab (`TABS`), so a "Notes" tab can be added later without a
 * redesign. Today there is exactly one tab (Contents), so no tab bar shows and
 * it reads as a plain popover with a heading.
 *
 * Non-modal dialog: opens from the trigger, closes on Esc / outside tap (both
 * owned by `ReaderDock`), moves focus to the first chapter on open. Presentational
 * + token-driven; the surface is the shared dock material.
 */

interface TocTab {
  id: string;
  label: string;
}

// Add a second entry here (e.g. `{ id: "notes", label: "Notes" }`) and the tab
// bar appears; the panel body then switches on the active tab. Not this stage.
const TABS: TocTab[] = [{ id: "contents", label: "Contents" }];

export interface TocPopoverProps {
  id: string;
  open: boolean;
  entries: ReaderTocEntry[];
  /** Current chapter title — marks the matching row `aria-current`. */
  currentLabel: string | null;
  onNavigate: (href: string) => void;
}

export function TocPopover({
  id,
  open,
  entries,
  currentLabel,
  onNavigate,
}: TocPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // Move focus into the popover on open (it unmounts on close, so a mount
  // effect is the open hook). Falls back to the panel when there are no rows.
  useEffect(() => {
    if (firstItemRef.current) firstItemRef.current.focus();
    else panelRef.current?.focus();
  }, []);

  if (!open) return null;

  const showTabBar = TABS.length > 1;
  const activeTab = TABS[0];

  return (
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label="Table of contents"
      tabIndex={-1}
      className="absolute left-1/2 z-40 flex -translate-x-1/2 flex-col gap-[var(--leaf-space-2)] border p-[var(--leaf-space-3)] outline-none"
      style={{
        bottom: "calc(100% + var(--leaf-space-2))",
        width:
          "min(var(--leaf-dock-popover-w), calc(100vw - var(--leaf-space-6)))",
        background: "var(--leaf-dock-bg)",
        borderColor: "var(--leaf-dock-border)",
        borderRadius: "var(--leaf-radius-lg)",
        boxShadow: "var(--leaf-shadow-sheet)",
        color: "var(--leaf-dock-text)",
      }}
    >
      <div
        className="border-b pb-[var(--leaf-space-2)] font-display [font-size:var(--leaf-text-sm)]"
        style={{ borderColor: "var(--leaf-dock-border)" }}
      >
        {showTabBar ? "Chapters" : activeTab.label}
      </div>

      {entries.length === 0 ? (
        <p
          className="py-[var(--leaf-space-2)] font-ui [font-size:var(--leaf-text-xs)]"
          style={{ color: "var(--leaf-dock-text-muted)" }}
        >
          This book has no chapter list.
        </p>
      ) : (
        <ul className="flex max-h-[40vh] flex-col gap-[var(--leaf-space-1)] overflow-y-auto">
          {entries.map((entry, i) => {
            const current =
              currentLabel != null && entry.label === currentLabel;
            return (
              <li key={`${entry.href}::${i}`}>
                <button
                  ref={i === 0 ? firstItemRef : undefined}
                  type="button"
                  onClick={() => onNavigate(entry.href)}
                  aria-current={current ? "true" : undefined}
                  className="flex w-full items-baseline gap-[var(--leaf-space-3)] rounded-md px-[var(--leaf-space-2)] py-[var(--leaf-space-1)] text-left font-ui [font-size:var(--leaf-text-xs)] outline-none transition-colors [transition-duration:var(--leaf-dur-ui)] [transition-timing-function:var(--leaf-ease)] hover:[background:var(--leaf-dock-hover)] focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
                  style={{
                    color: current
                      ? "var(--leaf-dock-text)"
                      : "var(--leaf-dock-text-muted)",
                    fontWeight: current ? 600 : 400,
                  }}
                >
                  <span className="truncate">{entry.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
