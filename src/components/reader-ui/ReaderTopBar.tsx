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
 * It hides in fullscreen and comes back when the deck opens. Fullscreen exists
 * to reclaim the browser's own chrome, and leaving Leaf's bar behind spends the
 * space straight back — the reader asked for the page, not for our header. The
 * resting dock stays visible throughout, so the deck (and with it this bar, and
 * the way back to the library) is always one tap away.
 *
 * In fullscreen it is taken OUT of the flex flow and positioned against the
 * reader layout's `relative` container — which is what that container's
 * `relative` is for. Rendering `null` and re-mounting it into the flow made
 * opening the deck shrink the frame by the bar's height: the prose jumped down,
 * and epub.js repaginated underneath it. Floating it means opening and closing
 * the deck moves nothing on the page. Out of flow it costs no height either, so
 * it stays mounted and merely fades.
 *
 * It carries the fullscreen toggle. Immersive is Fullscreen-only now, and
 * its job — removing the browser's URL bar and toolbars, 56–90px that no dock
 * design can reclaim — matters most on a phone, which has no `F` key. Without a
 * control here there would be no touch way into it at all.
 *
 * Presentational + token-driven.
 */

export interface ReaderTopBarProps {
  /** Whether the document is currently fullscreen (best-effort — see useImmersive). */
  immersive: boolean;
  /** Fullscreen: float the bar over the page instead of occupying flow height. */
  overlay: boolean;
  /** Fade the bar out. Only ever true while `overlay` is — in flow it always shows. */
  hidden: boolean;
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
  overlay,
  hidden,
  onToggleImmersive,
}: ReaderTopBarProps) {
  return (
    <header
      aria-hidden={hidden}
      inert={hidden}
      className={
        "z-30 flex items-center justify-between " +
        "[padding-block:var(--leaf-reader-bar-pad-y)] " +
        "[padding-inline:var(--leaf-reader-bar-pad-x)] " +
        "[transition:opacity_var(--leaf-dur-ui)_var(--leaf-ease)] " +
        (overlay ? "absolute inset-x-0 top-0" : "flex-none")
      }
      style={{
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? "none" : undefined,
        // Floating over prose, it needs its own ground to stay legible — the
        // same material the dock uses, so the two read as one layer of chrome.
        background: overlay ? "var(--leaf-dock-bg)" : undefined,
        borderBottom: overlay
          ? "1px solid var(--leaf-dock-border)"
          : undefined,
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
