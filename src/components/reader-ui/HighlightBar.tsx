"use client";

import type { KeyboardEvent } from "react";
import { barButtonClass } from "./bar-styles";

/**
 * HighlightBar — the actions for a painted highlight, shown in the top bar's
 * slot when the reader taps it (NOTES_PLAN N3d). Add note and Remove only; Share
 * stays in the Notes tab, which owns the group state it needs.
 *
 * A highlight WITH a note, or one being given its first note, is different: the
 * slot is a quiet "Note" label on the bar's left edge with the ✕ at the far end.
 * The note itself is read, and written, in the note card that hangs under the
 * top bar (HighlightNoteCard). Edit and Remove live on that card.
 *
 * Layout matches SelectionBar: the content is a group centred in the row, with
 * the ✕ at the far end and an equal-width pod at the start to balance it.
 */

export interface HighlightBarProps {
  /** The highlight's note, if it has one. Only its presence is read here. */
  note?: string | null;
  /** The note card's editor is open: the slot shows the Note label, not the actions. */
  editing?: boolean;
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

export function HighlightBar({ note, editing = false, onNote, onRemove, onClose }: HighlightBarProps) {
  const showsLabel = Boolean(note) || editing;

  return (
    <div
      role="toolbar"
      aria-label="Highlight actions"
      onKeyDown={(e) => onEscape(e, onClose)}
      className="flex h-full w-full min-w-0 items-center gap-[var(--leaf-space-3)]"
    >
      {showsLabel ? (
        <>
          {/* No inner padding: the label sits on the bar's left edge, as the note text does. */}
          <span className="min-w-0 flex-1 truncate font-mono font-medium uppercase text-ink-mid [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-wide)]">
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
