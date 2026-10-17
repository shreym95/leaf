"use client";

import type { KeyboardEvent } from "react";
import { barButtonClass } from "./bar-styles";

/**
 * HighlightBar — the actions for a painted highlight, shown in the top bar's
 * slot when the reader taps it (NOTES_PLAN N3d). Add note and Remove only; Share
 * stays in the Notes tab, which owns the group state it needs.
 *
 * A highlight WITH a note is different: the slot is a quiet "Note" row with the
 * ✕ at the far end, and the note itself is read in the note card that hangs
 * under the top bar (HighlightNoteCard). Edit and Remove live on that card.
 *
 * Layout matches SelectionBar: the content is a group centred in the row, with
 * the ✕ at the far end and an equal-width pod at the start to balance it.
 */

export interface HighlightBarProps {
  /** The highlight's note, if it has one. Only its presence is read here. */
  note?: string | null;
  onNote: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Esc dismisses the bar from any of its controls. */
function onEscape(e: KeyboardEvent<HTMLDivElement>, close: () => void): void {
  if (e.key !== "Escape") return;
  e.stopPropagation();
  close();
}

export function HighlightBar({ note, onNote, onRemove, onClose }: HighlightBarProps) {
  const hasNote = Boolean(note);

  return (
    <div
      role="toolbar"
      aria-label="Highlight actions"
      onKeyDown={(e) => onEscape(e, onClose)}
      className="flex h-full w-full min-w-0 items-center gap-[var(--leaf-space-3)]"
    >
      {hasNote ? (
        <>
          <span className="min-w-0 flex-1 truncate px-[var(--leaf-space-2)] font-mono font-medium uppercase text-ink-mid [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-wide)]">
            Note
          </span>
        </>
      ) : (
        <>
          <span aria-hidden className="min-w-[var(--leaf-dock-pod-size)] flex-none" />
          <div className="flex min-w-0 flex-1 items-center justify-center gap-[var(--leaf-space-3)]">
            <button type="button" className={`${barButtonClass} flex-none`} onClick={onNote}>
              Add note
            </button>
            <button type="button" className={`${barButtonClass} flex-none`} onClick={onRemove}>
              Remove
            </button>
          </div>
        </>
      )}

      <button
        type="button"
        aria-label="Close highlight actions"
        className={`${barButtonClass} min-w-[var(--leaf-dock-pod-size)] justify-center`}
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
