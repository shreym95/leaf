"use client";

import { JumpChip } from "./JumpChip";
import { shortenForJumpChip } from "./chapter-label";

/**
 * SyncOfferChip — a further reading position synced from another device,
 * offered rather than applied.
 *
 * A sibling of `ReturnChip`, not a generalisation of it, even though the two
 * share a shell (`JumpChip`) and a token surface: their semantics point in
 * opposite directions. `ReturnChip` undoes a jump the reader ALREADY made —
 * it always has somewhere concrete and recent to send them back to.
 * `SyncOfferChip` proposes a jump NOBODY here asked for, sourced from a
 * device the reader may not even remember using. Folding "offer a foreign
 * position" into "return to my own last position" would blur exactly the
 * distinction that keeps `ReturnChip` trustworthy — see its own header: it is
 * deliberately the ONLY undo in the reader. This stays a separate, explicitly
 * OPT-IN control instead.
 *
 * `docs/REVISED_PLAN.md` §8(c) already settled the underlying policy for
 * cross-device sync: a passive prompt, never silent convergence. This is
 * that prompt. `src/reader/position.ts`'s background reconcile decides WHEN
 * to offer (local present, server strictly further along, reader hasn't
 * already read past it); this component only ever decides how it looks.
 *
 * Accepting is itself a non-linear jump, so `ReaderShell` wires `onContinue`
 * through the exact same `jumpTo` it already uses for chapter/bookmark
 * navigation — accepting this offer leaves a working `ReturnChip` behind,
 * for free, the same as any other jump.
 *
 * Dismissal follows `ReturnChip`'s own precedent exactly (see that file):
 * clears on use, after a handful of page turns, or via the explicit ×. No
 * separate lifetime rule invented for this one.
 */

export interface SyncOfferChipProps {
  /** The offered position's chapter, already formatted for display —
   *  resolved via `ReaderController.chapterLabelForCfi` +
   *  `formatChapterLabel`, never a raw CFI or bare percentage. */
  label: string | null;
  onContinue: () => void;
  onDismiss: () => void;
}

export function SyncOfferChip({ label, onContinue, onDismiss }: SyncOfferChipProps) {
  // Shortened for the pill itself only — see `ReturnChip`'s own comment.
  // `aria-label`s below stay built from the full `label`.
  const shortLabel = shortenForJumpChip(label);
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
          {/* Horizontal mirror of `ReturnChip`'s own "corner" arrow — same
              stroke weight and construction, pointing forward instead of
              back, so the pair reads as "undo" / "redo" rather than as two
              unrelated glyphs. Previously a corner-brackets icon, which is
              the exact glyph `ReaderTopBar` uses for the fullscreen toggle —
              on a phone the two sit on the same screen and read as the same
              control (founder, 2026-09-28). This one is used nowhere else in
              the reader's chrome. */}
          <path d="M15 14 20 9l-5-5" />
          <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
        </svg>
      }
      label={shortLabel ? `Continue at ${shortLabel}` : "Continue reading"}
      ariaLabel={
        label
          ? `Continue at ${label} — synced from another device`
          : "Continue from where you left off on another device"
      }
      onActivate={onContinue}
      onDismiss={onDismiss}
      dismissAriaLabel={
        label
          ? `Dismiss continue at ${label} offer`
          : "Dismiss continue reading offer"
      }
    />
  );
}
