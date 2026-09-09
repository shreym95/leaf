"use client";

/**
 * RibbonBookmark — the tab hung from the top edge of the text column (design
 * iteration 1, REVISED_PLAN §9B; the visible design Phase 2 item 1 was blocked
 * on). Toggles a bookmark for the page on screen via `ReaderShell`'s existing
 * `toggleBookmark`; its bookmark list stays reachable through the settings
 * sheet's Notes row.
 *
 * A real `<button>` with an accessible name that reflects state. The notch is a
 * `clip-path` on an inner span, not the button itself, so the focus ring (a
 * box-shadow, which `clip-path` would otherwise crop) stays visible.
 * Presentational + token-driven.
 */

export interface RibbonBookmarkProps {
  /** The page on screen is already bookmarked. */
  active: boolean;
  /** No position reported yet — nothing to bookmark. */
  disabled?: boolean;
  onToggle: () => void;
}

export function RibbonBookmark({
  active,
  disabled = false,
  onToggle,
}: RibbonBookmarkProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={active}
      aria-label={active ? "Remove bookmark from this page" : "Bookmark this page"}
      className="absolute top-0 z-20 rounded-b-sm outline-none [transition:height_var(--leaf-dur-ui)_var(--leaf-ease)] focus-visible:[box-shadow:var(--leaf-shadow-focus)] disabled:opacity-40 disabled:pointer-events-none"
      style={{
        right: "var(--leaf-ribbon-inset)",
        width: "var(--leaf-ribbon-w)",
        height: active
          ? "var(--leaf-ribbon-h-active)"
          : "var(--leaf-ribbon-h)",
      }}
    >
      <span
        aria-hidden
        className="block h-full w-full [transition:background_var(--leaf-dur-ui)_var(--leaf-ease)]"
        style={{
          background: active ? "var(--leaf-accent)" : "var(--leaf-rule)",
          clipPath:
            "polygon(0 0, 100% 0, 100% 100%, 50% var(--leaf-ribbon-notch), 0 100%)",
        }}
      />
    </button>
  );
}
