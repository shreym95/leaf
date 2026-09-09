"use client";

import Link from "next/link";

/**
 * ReaderTopBar — the reader's own top chrome (SPEC §8), replacing the app
 * NavBar in the reader route group.
 *
 * Since the reader dock (design iteration 1) this is deliberately just two
 * things: the way back to the library and the wordmark. Everything else it used
 * to carry moved into the dock — title/author are on the expanded deck's
 * progress island, "Aa" is the deck's `⋯` settings pod, Notes is a row in the
 * settings sheet. It no longer hides: the dock is small enough to leave the
 * chrome up, and immersive mode is now Fullscreen-only.
 *
 * It does carry the fullscreen toggle. Immersive is Fullscreen-only now, and
 * its job — removing the browser's URL bar and toolbars, 56–90px that no dock
 * design can reclaim — matters most on a phone, which has no `F` key. Without a
 * control here there would be no touch way into it at all.
 *
 * Presentational + token-driven.
 */

export interface ReaderTopBarProps {
  /** Whether the document is currently fullscreen (best-effort — see useImmersive). */
  immersive: boolean;
  onToggleImmersive: () => void;
}

const controlClass =
  "inline-flex items-center gap-[var(--leaf-space-2)] rounded-sm font-mono font-medium " +
  "uppercase text-ink-mid transition-colors hover:text-ink " +
  "[font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-wide)] " +
  "[transition-duration:var(--leaf-dur-ui)] " +
  "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]";

export function ReaderTopBar({
  immersive,
  onToggleImmersive,
}: ReaderTopBarProps) {
  return (
    <header
      className="z-30 flex flex-none items-center justify-between [padding-block:var(--leaf-reader-bar-pad-y)] [padding-inline:var(--leaf-reader-bar-pad-x)]"
      style={{
        paddingTop: `calc(var(--leaf-reader-bar-pad-y) + var(--leaf-safe-top))`,
        paddingLeft: `calc(var(--leaf-reader-bar-pad-x) + var(--leaf-safe-left))`,
        paddingRight: `calc(var(--leaf-reader-bar-pad-x) + var(--leaf-safe-right))`,
      }}
    >
      <Link
        href="/library"
        className={controlClass}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Library
      </Link>

      <div className="flex items-center gap-[var(--leaf-space-5)]">
        <span
          aria-hidden
          className="font-mono font-medium uppercase text-accent [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-eyebrow)]"
        >
          Leaf
        </span>

        <button
          type="button"
          onClick={onToggleImmersive}
          aria-pressed={immersive}
          aria-label={immersive ? "Exit full screen" : "Enter full screen"}
          className={controlClass}
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            {immersive ? (
              /* Arrows pulling inward — collapse. */
              <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
            ) : (
              /* Corner brackets pushing outward — expand. */
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            )}
          </svg>
        </button>
      </div>
    </header>
  );
}
