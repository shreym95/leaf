"use client";

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
 * Presentational + token-driven; it borrows the dock's surface so the reader
 * reads it as the same layer of chrome, not a notification.
 */

export interface ReturnChipProps {
  /** Where the reader jumped FROM, already formatted for display. */
  label: string | null;
  onReturn: () => void;
}

export function ReturnChip({ label, onReturn }: ReturnChipProps) {
  return (
    <button
      type="button"
      onClick={onReturn}
      aria-label={label ? `Return to ${label}` : "Return to where you were"}
      className="absolute left-1/2 top-[var(--leaf-space-4)] z-30 flex -translate-x-1/2 items-center gap-[var(--leaf-space-2)] border px-[var(--leaf-space-4)] font-mono uppercase outline-none [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-wide)] [transition:background_var(--leaf-dur-ui)_var(--leaf-ease)] hover:[background:var(--leaf-dock-hover)] focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
      style={{
        background: "var(--leaf-dock-bg)",
        borderColor: "var(--leaf-dock-border)",
        color: "var(--leaf-dock-text)",
        boxShadow: "var(--leaf-dock-shadow)",
        height: "var(--leaf-dock-h)",
        borderRadius: "var(--leaf-dock-radius)",
      }}
    >
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
      <span className="max-w-[18ch] truncate">
        {label ? `Back to ${label}` : "Back"}
      </span>
    </button>
  );
}
