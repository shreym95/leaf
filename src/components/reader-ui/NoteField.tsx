"use client";

import { useState, type FormEvent } from "react";
import { barButtonClass, barCounterClass } from "./bar-styles";

/**
 * NoteField — the note editor in the top bar's slot (NOTES_PLAN N3a). One line
 * tall, like the rest of the slot, so writing a note never resizes the bar or
 * repaginates the book. Length rules match the Notes item editor: up to 500
 * characters, and an empty note saves as null, which removes it.
 */

export const NOTE_MAX = 500;

export interface NoteFieldProps {
  /** The note being edited, or "" for a new one. */
  initial: string;
  onSave: (note: string | null) => void;
  onCancel: () => void;
}

export function NoteField({ initial, onSave, onCancel }: NoteFieldProps) {
  const [draft, setDraft] = useState(initial);
  const length = draft.length;
  const over = length > NOTE_MAX;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (over) return;
    const trimmed = draft.trim();
    onSave(trimmed.length > 0 ? trimmed : null);
  };

  return (
    <form
      onSubmit={submit}
      aria-label="Note"
      className="flex h-full w-full min-w-0 items-center gap-[var(--leaf-space-3)]"
    >
      <input
        // Focused on mount: the reader asked to write a note. Single line, so
        // the bar keeps its height.
        autoFocus
        type="text"
        aria-label="Note"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        aria-invalid={over || undefined}
        className="h-full min-w-0 flex-1 bg-transparent font-ui text-ink outline-none [font-size:var(--leaf-text-xs)] focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
        style={{ borderBottom: "1px solid var(--leaf-dock-border)" }}
      />
      <span
        aria-live="polite"
        className={`${barCounterClass} flex-none ${over ? "text-accent" : "text-ink-mid"}`}
      >
        {length}/{NOTE_MAX}
      </span>
      <button type="submit" disabled={over} className={barButtonClass}>
        Save
      </button>
      <button type="button" onClick={onCancel} className={barButtonClass}>
        Cancel
      </button>
    </form>
  );
}
