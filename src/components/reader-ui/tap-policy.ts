// Touch page-turn policy (NOTES_PLAN N3d). Pure, so every branch is covered
// without an iframe. ReaderShell feeds it one `onContentTap` at a time.

/** A tap that collapsed a selection within this window is not a page turn. */
export const COLLAPSE_GRACE_MS = 300;
/** A tap on a painted highlight also reaches the content tap; this window swallows it. */
export const HIGHLIGHT_TAP_GUARD_MS = 300;
/** Taps left of this fraction of the frame go back. */
export const PREV_ZONE_FRACTION = 0.3;
/** Taps from PREV_ZONE_FRACTION up to this fraction toggle the bars; taps at or past it go forward. */
export const NEXT_ZONE_FRACTION = 0.6;

export type ContentTapAction = "clear-selection" | "ignore" | "prev" | "next" | "toggle-bars";

export interface ContentTapInput {
  /** True when the primary pointer is coarse (touch). Fine pointers use the edge buttons. */
  coarse: boolean;
  /** The book iframe still holds a non-collapsed selection with text. */
  selectionActive: boolean;
  /** Milliseconds since the last selection collapse (Infinity if none). */
  msSinceCollapse: number;
  /** Milliseconds since the last tap on a painted highlight (Infinity if none). */
  msSinceHighlightTap: number;
  /** 0..1 across the reader frame. */
  xFraction: number;
}

export function decideContentTap(input: ContentTapInput): ContentTapAction {
  if (!input.coarse) return "ignore";
  if (input.selectionActive) return "clear-selection";
  if (input.msSinceCollapse < COLLAPSE_GRACE_MS) return "ignore";
  if (input.msSinceHighlightTap < HIGHLIGHT_TAP_GUARD_MS) return "ignore";
  if (input.xFraction < PREV_ZONE_FRACTION) return "prev";
  if (input.xFraction < NEXT_ZONE_FRACTION) return "toggle-bars";
  return "next";
}

/** True for a touch-first pointer. False when `matchMedia` is unavailable (jsdom). */
export function isCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(pointer: coarse)").matches;
}
