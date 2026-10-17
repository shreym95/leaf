"use client";

import type { PointerEvent, MouseEvent } from "react";
import { barButtonClass } from "./bar-styles";

/**
 * SelectionBar — the actions for a settled text selection, shown in the top
 * bar's slot (NOTES_PLAN N3a). Presentational: the shell owns the selection
 * and does the work.
 *
 * Highlight and Note act on `pointerdown`. A tap outside the book iframe
 * collapses the selection before `click` fires, so the action has to read the
 * selection on the way down. A `click` that follows a pointer press is
 * ignored; a keyboard activation (click with `detail` 0) acts instead, so
 * the bar works without a pointer.
 */

export interface SelectionBarProps {
  /** The selected text, for Define's eligibility and query. */
  text: string;
  onHighlight: () => void;
  onNote: () => void;
  onClose: () => void;
}

const DEFINE_MAX_WORDS = 3;
const DEFINE_MAX_CHARS = 40;

/** Trims leading and trailing punctuation, symbols and space. */
export function defineTerm(text: string): string {
  return text.trim().replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");
}

/** Define is offered only for a short term: at most 3 words and 40 characters. */
export function canDefine(text: string): boolean {
  const term = defineTerm(text);
  if (term.length === 0 || term.length > DEFINE_MAX_CHARS) return false;
  return term.split(/\s+/).length <= DEFINE_MAX_WORDS;
}

export function defineHref(text: string): string {
  return (
    "https://www.google.com/search?" +
    new URLSearchParams({ q: `define ${defineTerm(text)}` }).toString()
  );
}

/** Acts on a primary pointer press; the keyboard path is the click with detail 0. */
function onPrimaryPress(e: PointerEvent<HTMLButtonElement>, act: () => void): void {
  // Keeps focus and the book's selection where they are until the action has read them.
  e.preventDefault();
  if (e.button !== 0) return;
  act();
}

function onKeyboardClick(e: MouseEvent<HTMLButtonElement>, act: () => void): void {
  if (e.detail === 0) act();
}

export function SelectionBar({ text, onHighlight, onNote, onClose }: SelectionBarProps) {
  const eligible = canDefine(text);

  return (
    <div
      role="toolbar"
      aria-label="Selected text actions"
      className="flex h-full w-full min-w-0 items-center justify-between gap-[var(--leaf-space-3)]"
    >
      <div className="flex min-w-0 items-center gap-[var(--leaf-space-3)]">
        <button
          type="button"
          className={barButtonClass}
          onPointerDown={(e) => onPrimaryPress(e, onHighlight)}
          onClick={(e) => onKeyboardClick(e, onHighlight)}
        >
          Highlight
        </button>
        <button
          type="button"
          className={barButtonClass}
          onPointerDown={(e) => onPrimaryPress(e, onNote)}
          onClick={(e) => onKeyboardClick(e, onNote)}
        >
          Note
        </button>
        {eligible && (
          <a
            href={defineHref(text)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Define in a new tab"
            className={barButtonClass}
            onPointerDown={(e) => e.preventDefault()}
          >
            Define
          </a>
        )}
      </div>

      <button
        type="button"
        aria-label="Clear selection"
        className={`${barButtonClass} min-w-[var(--leaf-dock-pod-size)] justify-center`}
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
