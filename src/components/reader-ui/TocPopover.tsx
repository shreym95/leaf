"use client";

import { useEffect, useRef, useState } from "react";
import type { ReaderTocEntry } from "@/reader/engine";

/**
 * TocPopover — the chapter drawer above the dock's `≡` pod (design iteration 1).
 *
 * Structured as a tabbed panel whose tab bar renders ONLY when there is more
 * than one tab (`TABS`), so a further tab can be added without a redesign.
 * Today: Contents and Bookmarks. Bookmarks moved here when the frame's top-edge
 * ribbon was removed — the pill's bookmark pod creates them, this lists them.
 *
 * Non-modal dialog: opens from the trigger, closes on Esc / outside tap (both
 * owned by `ReaderDock`), moves focus to the first chapter on open. Presentational
 * + token-driven; the surface is the shared dock material.
 */

interface TocTab {
  id: string;
  label: string;
}

// Add an entry here (e.g. `{ id: "notes", label: "Notes" }`) and the tab bar
// grows; the panel body switches on the active tab id.
const TABS: TocTab[] = [
  { id: "contents", label: "Contents" },
  { id: "bookmarks", label: "Bookmarks" },
];

export interface DockBookmark {
  id: string;
  cfi: string;
  label: string | null;
  percent: number | null;
}

export interface TocPopoverProps {
  id: string;
  open: boolean;
  entries: ReaderTocEntry[];
  /** Current chapter title — marks the matching row `aria-current`. */
  currentLabel: string | null;
  onNavigate: (href: string) => void;
  bookmarks: DockBookmark[];
  onGoToBookmark: (cfi: string) => void;
  onRemoveBookmark: (id: string) => void;
}

export function TocPopover({
  id,
  open,
  entries,
  currentLabel,
  onNavigate,
  bookmarks,
  onGoToBookmark,
  onRemoveBookmark,
}: TocPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const [tabId, setTabId] = useState(TABS[0].id);

  // Move focus into the popover on open (it unmounts on close, so a mount
  // effect is the open hook). Falls back to the panel when there are no rows.
  useEffect(() => {
    if (firstItemRef.current) firstItemRef.current.focus();
    else panelRef.current?.focus();
  }, []);

  // Hooks must run in the same order on every render, so this sits above the
  // `open` early-return, not below it.
  const showTabBar = TABS.length > 1;
  const activeTab = TABS.find((t) => t.id === tabId) ?? TABS[0];

  if (!open) return null;

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
        boxShadow: "var(--leaf-dock-shadow)",
        color: "var(--leaf-dock-text)",
      }}
    >
      {showTabBar ? (
        <div
          role="tablist"
          aria-label="Contents and bookmarks"
          className="flex gap-[var(--leaf-space-2)] border-b pb-[var(--leaf-space-2)]"
          style={{ borderColor: "var(--leaf-dock-border)" }}
        >
          {TABS.map((t) => {
            const selected = t.id === activeTab.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTabId(t.id)}
                className="rounded-md px-[var(--leaf-space-2)] py-[var(--leaf-space-1)] font-mono uppercase outline-none transition-colors [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-wide)] [transition-duration:var(--leaf-dur-ui)] hover:[background:var(--leaf-dock-hover)] focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
                style={{
                  color: selected
                    ? "var(--leaf-dock-text)"
                    : "var(--leaf-dock-text-muted)",
                  background: selected
                    ? "var(--leaf-dock-hover)"
                    : "transparent",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div
          className="border-b pb-[var(--leaf-space-2)] font-display [font-size:var(--leaf-text-sm)]"
          style={{ borderColor: "var(--leaf-dock-border)" }}
        >
          {activeTab.label}
        </div>
      )}

      {activeTab.id === "contents" ? (
        entries.length === 0 ? (
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
        )
      ) : bookmarks.length === 0 ? (
        <p
          className="py-[var(--leaf-space-2)] font-ui [font-size:var(--leaf-text-xs)]"
          style={{ color: "var(--leaf-dock-text-muted)" }}
        >
          No bookmarks yet. Tap the bookmark pod to save this page.
        </p>
      ) : (
        <ul className="flex max-h-[40vh] flex-col gap-[var(--leaf-space-1)] overflow-y-auto">
          {bookmarks.map((b) => (
            <li key={b.id} className="flex items-center gap-[var(--leaf-space-1)]">
              <button
                type="button"
                onClick={() => onGoToBookmark(b.cfi)}
                className="flex min-w-0 flex-1 items-baseline gap-[var(--leaf-space-3)] rounded-md px-[var(--leaf-space-2)] py-[var(--leaf-space-1)] text-left font-ui [font-size:var(--leaf-text-xs)] outline-none transition-colors [transition-duration:var(--leaf-dur-ui)] hover:[background:var(--leaf-dock-hover)] focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
                style={{ color: "var(--leaf-dock-text)" }}
              >
                <span className="truncate">{b.label ?? "Bookmark"}</span>
                {b.percent != null && (
                  <span
                    className="ml-auto flex-none font-mono tabular-nums [font-size:var(--leaf-text-3xs)]"
                    style={{ color: "var(--leaf-dock-text-muted)" }}
                  >
                    {Math.round(b.percent * 100)}%
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onRemoveBookmark(b.id)}
                aria-label={`Remove bookmark ${b.label ?? ""}`.trim()}
                className="flex-none rounded-md px-[var(--leaf-space-2)] py-[var(--leaf-space-1)] font-mono outline-none transition-colors [font-size:var(--leaf-text-3xs)] [transition-duration:var(--leaf-dur-ui)] hover:[background:var(--leaf-dock-hover)] focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
                style={{ color: "var(--leaf-dock-text-muted)" }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
