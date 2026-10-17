"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { barButtonClass, barCounterClass, barEdgeStyle, barNoticeClass, barRowClass } from "./bar-styles";

/**
 * HighlightNoteCard — the readable note of a highlight, and its editor (founder
 * design, 2026-10-17). It hangs under the top bar and overlays the top of the
 * page, so opening it never reflows or repaginates the book.
 *
 * The note is set in the book's own reading face and size, at full ink. Read
 * view shows about four lines before it scrolls, with Edit note and Remove under
 * it. Editing swaps the same text for a textarea in the same type: it grows to
 * about four lines and then scrolls, with Save and Cancel under it and the
 * counter at the far end of that row.
 *
 * Every line in the card and the bar row hangs from one left edge (barEdgeStyle),
 * so the note, the editor and the action labels all start where the bar's label
 * does.
 *
 * The editing state lives with the shell, which owns the draft: a deck open hides
 * the card and must not lose unsaved text. This component is presentational and
 * takes no focus on open, except that it moves focus into the editor when editing
 * starts, and back to Edit note when editing ends.
 *
 * Dismissal is not handled here: ReaderTopBar's ✕, Esc, a page tap, the deck and
 * a page turn are the shell's (see ReaderShell for the unsaved-text rule).
 */

/** Lines of note visible before the card scrolls. */
export const NOTE_CARD_MAX_LINES = 4;
/** Longest note the editor accepts. Matches the store's limit. */
export const NOTE_MAX = 500;

/** The note's type: the reader's own face, size and leading, at full ink. */
const noteTextClass =
  "font-reader-serif text-ink whitespace-pre-wrap [overflow-wrap:anywhere] " +
  "[font-size:var(--leaf-reader-font-size)] [line-height:var(--leaf-reader-leading)]";

export interface HighlightNoteCardProps {
  /** The saved note, or "" when the highlight has none. */
  note: string;
  /** Whether the editor is open. */
  editing: boolean;
  /** The editor's text. Only read while editing. */
  draft: string;
  onDraftChange: (draft: string) => void;
  /** Edit note: the shell opens the editor on the saved text. */
  onEdit: () => void;
  /** Saves the draft, trimmed. An empty draft saves as null, which removes the note. */
  onSave: (note: string | null) => void;
  /** Cancel, and Esc from anywhere in the card while editing. Discards the draft. */
  onCancel: () => void;
  onRemove: () => void;
}

export function HighlightNoteCard({
  note,
  editing,
  draft,
  onDraftChange,
  onEdit,
  onSave,
  onCancel,
  onRemove,
}: HighlightNoteCardProps) {
  const [confirming, setConfirming] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);
  const counterId = useId();

  const length = draft.length;
  const over = length > NOTE_MAX;

  // Focus into the editor with the caret at the end, when editing starts.
  useEffect(() => {
    if (!editing) return;
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [editing]);

  // Back to Edit note when editing ends, so keyboard focus is not lost.
  useEffect(() => {
    if (wasEditing.current && !editing) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  // Grow with the text up to the card's line cap; the cap's max-height scrolls it.
  useLayoutEffect(() => {
    if (!editing) return;
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [editing, draft]);

  const save = () => {
    if (over) return;
    const trimmed = draft.trim();
    onSave(trimmed.length > 0 ? trimmed : null);
  };

  // Esc from anywhere in the card cancels the edit; the shell's Esc then has nothing to do.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || !editing) return;
    e.stopPropagation();
    onCancel();
  };

  return (
    <section
      aria-label="Note"
      onKeyDown={onKeyDown}
      className={
        "absolute inset-x-0 top-full border-b border-rule bg-page " +
        "[padding-block:var(--leaf-space-4)] " +
        // Opacity-only entry, at 40% of the UI duration (100ms). Reduced motion
        // zeroes --leaf-dur-ui, so the fade vanishes with it. `starting:` is the
        // CSS entry state, so there is no JS-driven second frame.
        "[transition:opacity_calc(var(--leaf-dur-ui)*0.4)_var(--leaf-ease)] " +
        "starting:opacity-0"
      }
      style={barEdgeStyle}
    >
      {editing ? (
        <>
          <textarea
            ref={fieldRef}
            aria-label="Note"
            aria-describedby={counterId}
            aria-invalid={over || undefined}
            rows={1}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            className={
              "block w-full min-w-0 resize-none overflow-y-auto bg-transparent p-0 outline-none " +
              noteTextClass +
              " focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
            }
            style={{ maxHeight: `${NOTE_CARD_MAX_LINES}lh` }}
          />

          <div className={`${barRowClass} mt-[var(--leaf-space-3)] flex flex-wrap items-center gap-[var(--leaf-space-3)]`}>
            <button type="button" className={barButtonClass} disabled={over} onClick={save}>
              Save
            </button>
            <button type="button" className={barButtonClass} onClick={onCancel}>
              Cancel
            </button>
            <span
              id={counterId}
              className={`${barCounterClass} ml-auto mr-[var(--leaf-space-2)] ${over ? "text-accent" : "text-ink-mid"}`}
            >
              {length}/{NOTE_MAX}
            </span>
          </div>
        </>
      ) : (
        <>
          <div
            // Scrolls past NOTE_CARD_MAX_LINES. Focusable so a keyboard reader can
            // scroll it; the line box is the reader's own text size and leading.
            tabIndex={0}
            className={
              "overflow-y-auto " +
              noteTextClass +
              " focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
            }
            style={{ maxHeight: `${NOTE_CARD_MAX_LINES}lh` }}
          >
            {note}
          </div>

          <div className={`${barRowClass} mt-[var(--leaf-space-3)] flex flex-wrap items-center gap-[var(--leaf-space-3)]`}>
            {confirming ? (
              <>
                <span className={barNoticeClass}>Remove note too?</span>
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
              </>
            ) : (
              <>
                <button ref={editRef} type="button" className={barButtonClass} onClick={onEdit}>
                  Edit note
                </button>
                <button
                  type="button"
                  className={barButtonClass}
                  onClick={() => setConfirming(true)}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
