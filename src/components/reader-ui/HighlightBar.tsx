"use client";

import { useState, type KeyboardEvent } from "react";
import { barButtonClass, barNoticeClass } from "./bar-styles";

/**
 * HighlightBar — the actions for a painted highlight, shown in the top bar's
 * slot when the reader taps it (NOTES_PLAN N3d). Note and Remove only. Share
 * stays in the Notes tab, which owns the group state it needs.
 *
 * A highlight with a note asks before it is removed, as the Notes list does.
 * A highlight with a note shows that note's text on one line, truncated; the
 * Edit note action opens the editor with the full text.
 *
 * Layout matches SelectionBar: the content is a group centred in the row, with
 * the ✕ at the far end and an equal-width pod at the start to balance it.
 */

export interface HighlightBarProps {
  /** The highlight's note, if it has one. Shown on one truncated line. */
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
  const [confirming, setConfirming] = useState(false);
  const hasNote = Boolean(note);

  return (
    <div
      role="toolbar"
      aria-label="Highlight actions"
      onKeyDown={(e) => onEscape(e, onClose)}
      className="flex h-full w-full min-w-0 items-center gap-[var(--leaf-space-3)]"
    >
      <span aria-hidden className="min-w-[var(--leaf-dock-pod-size)] flex-none" />

      {confirming ? (
        <div className="flex min-w-0 flex-1 items-center justify-center gap-[var(--leaf-space-3)]">
          <span className={`${barNoticeClass} min-w-0`}>Remove note too?</span>
          <button type="button" className={barButtonClass} onClick={onRemove}>
            Remove
          </button>
          <button
            type="button"
            className={barButtonClass}
            onClick={() => setConfirming(false)}
          >
            Keep
          </button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-center gap-[var(--leaf-space-3)]">
          {hasNote && (
            <span className={`${barNoticeClass} min-w-0 flex-1 text-center`}>{note}</span>
          )}
          <button type="button" className={`${barButtonClass} flex-none`} onClick={onNote}>
            {hasNote ? "Edit note" : "Add note"}
          </button>
          <button
            type="button"
            className={`${barButtonClass} flex-none`}
            onClick={() => (hasNote ? setConfirming(true) : onRemove())}
          >
            Remove
          </button>
        </div>
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
