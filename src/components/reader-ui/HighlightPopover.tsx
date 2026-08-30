"use client";

import { useEffect, useRef } from "react";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_LABELS,
  highlightVar,
} from "@/design/highlight-theme";

/**
 * HighlightPopover — the small colour bar that appears when text is selected in
 * the book, and again when an existing highlight is tapped. Presentational +
 * token-driven; every action is a callback the shell wires to the highlight
 * manager.
 *
 * It is rendered in the HOST document (over the book frame), not inside the
 * epub.js iframe — so it can use the `--leaf-*` tokens directly.
 */

export interface HighlightPopoverProps {
  /** Anchor point in host-document coordinates, or null when hidden. */
  at: { x: number; y: number } | null;
  /** Set when an existing highlight is being edited (enables Remove). */
  existingColor?: string | null;
  onPick: (color: string) => void;
  onRemove?: () => void;
  onAddNote?: () => void;
  onDismiss: () => void;
}

export function HighlightPopover({
  at,
  existingColor,
  onPick,
  onRemove,
  onAddNote,
  onDismiss,
}: HighlightPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Esc dismisses; focus moves in so the whole bar is keyboard reachable.
  useEffect(() => {
    if (!at) return;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [at, onDismiss]);

  if (!at) return null;

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Highlight"
      className="fixed z-50 flex items-center gap-2 rounded-md border border-rule bg-page p-2 [box-shadow:var(--leaf-shadow-sheet)]"
      style={{
        left: `${at.x}px`,
        top: `${at.y}px`,
        transform: "translate(-50%, -100%)",
      }}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Highlight ${HIGHLIGHT_LABELS[color]}`}
          aria-pressed={existingColor === color}
          onClick={() => onPick(color)}
          className={
            "h-7 w-7 rounded-pill border transition-colors " +
            "[transition-duration:var(--leaf-dur-ui)] " +
            "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)] " +
            (existingColor === color ? "border-ink" : "border-rule")
          }
          style={{ background: highlightVar(color) }}
        />
      ))}

      {onAddNote && (
        <button
          type="button"
          onClick={onAddNote}
          className="rounded-sm px-2 py-1 font-mono uppercase text-ink-mid transition-colors hover:text-ink [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-label)] [transition-duration:var(--leaf-dur-ui)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
        >
          Note
        </button>
      )}

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-sm px-2 py-1 font-mono uppercase text-accent transition-colors hover:opacity-80 [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-label)] [transition-duration:var(--leaf-dur-ui)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
        >
          Remove
        </button>
      )}
    </div>
  );
}
