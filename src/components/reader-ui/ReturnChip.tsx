"use client";

import { JumpChip } from "./JumpChip";

/**
 * ReturnChip — the way back from a jump.
 *
 * Every non-linear move in a reader is destructive: tap a chapter in the
 * contents, or a bookmark, and the place you were holding is gone. Print does
 * not have this problem because your thumb stays in the page. Kindle's answer is
 * Page Flip, which pins the page you left; this is the same idea reduced to one
 * control — jump, and a chip appears offering the way back.
 *
 * It is deliberately the ONLY undo in the reader, and it is why Leaf can ship
 * chapter and bookmark navigation safely. It is also the prerequisite for ever
 * adding a drag-to-seek track, which is far more destructive again.
 *
 * Presentational + token-driven; it borrows the dock's surface (via
 * `JumpChip`, its shared shell with `SyncOfferChip`) so the reader reads it
 * as the same layer of chrome, not a notification.
 *
 * Dismissal: clears on use (tapping the return action) or after a handful of
 * page turns (`ReaderShell` owns that count) — the founder found it
 * persistent otherwise, so `onDismiss` adds an explicit × for "no, not now"
 * without waiting on either of those. NOT a clock: a timer short enough to
 * matter would retract the way back before a reader who jumped, read a page,
 * and reconsidered had finished reading it — turning a safety net into a
 * trap. `onDismiss` is optional so existing callers with nothing to dismiss
 * (and the tests that predate it) keep working with just the one button.
 */

export interface ReturnChipProps {
  /** Where the reader jumped FROM, already formatted for display. */
  label: string | null;
  onReturn: () => void;
  /** Explicit "no, not now" — dismissal is per-jump, never persisted; the
   *  next jump brings the chip back regardless of an earlier dismissal. */
  onDismiss?: () => void;
}

export function ReturnChip({ label, onReturn, onDismiss }: ReturnChipProps) {
  return (
    <JumpChip
      icon={
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[calc(var(--leaf-dock-icon)-4px)] w-[calc(var(--leaf-dock-icon)-4px)]"
        >
          <path d="M9 14 4 9l5-5" />
          <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
        </svg>
      }
      label={label ? `Back to ${label}` : "Back"}
      ariaLabel={label ? `Return to ${label}` : "Return to where you were"}
      onActivate={onReturn}
      onDismiss={onDismiss}
      dismissAriaLabel={
        label ? `Dismiss return to ${label}` : "Dismiss return to where you were"
      }
    />
  );
}
