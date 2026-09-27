"use client";

import { JumpChip } from "./JumpChip";

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
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
      }
      label={label ? `Continue from ${label}` : "Continue reading"}
      ariaLabel={
        label
          ? `Continue from ${label} — synced from another device`
          : "Continue from where you left off on another device"
      }
      onActivate={onContinue}
      onDismiss={onDismiss}
      dismissAriaLabel={
        label
          ? `Dismiss continue from ${label} offer`
          : "Dismiss continue reading offer"
      }
    />
  );
}
