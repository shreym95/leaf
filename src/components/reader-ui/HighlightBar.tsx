"use client";

import { useState } from "react";
import { barButtonClass } from "./bar-styles";

/**
 * HighlightBar — the actions for a painted highlight, shown in the top bar's
 * slot when the reader taps it (NOTES_PLAN N3d). Note and Remove only. Share
 * stays in the Notes tab, which owns the group state it needs.
 *
 * A highlight with a note asks before it is removed, as the Notes list does.
 */

export interface HighlightBarProps {
  hasNote: boolean;
  onNote: () => void;
  onRemove: () => void;
  onClose: () => void;
}

export function HighlightBar({ hasNote, onNote, onRemove, onClose }: HighlightBarProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      role="toolbar"
      aria-label="Highlight actions"
      className="flex h-full w-full min-w-0 items-center justify-between gap-[var(--leaf-space-3)]"
    >
      {confirming ? (
        <div className="flex min-w-0 items-center gap-[var(--leaf-space-3)]">
          <span className="font-mono uppercase text-ink-mid [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-wide)]">
            Remove note too?
          </span>
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
        <div className="flex min-w-0 items-center gap-[var(--leaf-space-3)]">
          <button type="button" className={barButtonClass} onClick={onNote}>
            {hasNote ? "Edit note" : "Add note"}
          </button>
          <button
            type="button"
            className={barButtonClass}
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
