"use client";

import { useState } from "react";
import { barButtonClass, barNoticeClass } from "./bar-styles";
import { NoteField } from "./NoteField";

/**
 * HighlightNoteCard — the readable note of a tapped highlight (founder design,
 * 2026-10-17). It drops down under the top bar and overlays the top of the page,
 * so opening it never reflows or repaginates the book.
 *
 * The note is set in the book's own reading face and size (the reader's tokens),
 * at full ink, and shows about four lines before it scrolls. Below it sit Edit
 * note and Remove. Edit swaps the body for the note editor in place; Save and
 * Cancel bring the card back. Remove asks first, as it always has for a note.
 *
 * Dismissal is not handled here: ReaderTopBar's ✕, Esc, a page tap, the deck and
 * a page turn all clear the highlight, which unmounts the card.
 *
 * It takes no focus on open. Presentational and token-driven.
 */

/** Lines of note visible before the card scrolls. */
export const NOTE_CARD_MAX_LINES = 4;

export interface HighlightNoteCardProps {
  note: string;
  /** Saves the edited note. An empty note removes it. */
  onSave: (note: string | null) => void;
  onRemove: () => void;
}

export function HighlightNoteCard({ note, onSave, onRemove }: HighlightNoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <section
      aria-label="Note"
      className={
        "absolute inset-x-0 top-full border-b border-rule bg-page " +
        "[padding-block:var(--leaf-space-4)] " +
        // Opacity-only entry, at 40% of the UI duration (100ms). Reduced motion
        // zeroes --leaf-dur-ui, so the fade vanishes with it. `starting:` is the
        // CSS entry state, so there is no JS-driven second frame.
        "[transition:opacity_calc(var(--leaf-dur-ui)*0.4)_var(--leaf-ease)] " +
        "starting:opacity-0"
      }
      style={{
        paddingLeft: "calc(var(--leaf-reader-bar-pad-x) + var(--leaf-safe-left))",
        paddingRight: "calc(var(--leaf-reader-bar-pad-x) + var(--leaf-safe-right))",
      }}
    >
      {editing ? (
        <NoteField
          initial={note}
          onSave={(next) => {
            onSave(next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div
            // Scrolls past NOTE_CARD_MAX_LINES. Focusable so a keyboard reader can
            // scroll it; the line box is the reader's own text size and leading.
            tabIndex={0}
            className={
              "overflow-y-auto font-reader-serif text-ink whitespace-pre-wrap [overflow-wrap:anywhere] " +
              "[font-size:var(--leaf-reader-font-size)] [line-height:var(--leaf-reader-leading)] " +
              "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
            }
            style={{ maxHeight: `${NOTE_CARD_MAX_LINES}lh` }}
          >
            {note}
          </div>

          <div className="mt-[var(--leaf-space-3)] flex flex-wrap items-center gap-[var(--leaf-space-3)]">
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
                <button type="button" className={barButtonClass} onClick={() => setEditing(true)}>
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
