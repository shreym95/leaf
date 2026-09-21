"use client";

import { useSyncExternalStore } from "react";

/**
 * OfflineIndicator — Stage 4 offline reading, part 3. A quiet, non-modal
 * signal that this device has lost its connection: the open book keeps
 * working and its place is being kept locally, but the library needs a
 * connection to reach anything else.
 *
 * Renders nothing at all while online — "do not add clutter" (brief) means
 * the honest answer here is a single small element that only exists when it
 * has something to say.
 *
 * Placement: `ReaderTopBar` is `justify-between` — "Library" on the left,
 * the wordmark + fullscreen toggle on the right — leaving its middle
 * deliberately empty. This renders into that empty middle from a sibling
 * position in `ReaderShell`'s own markup (`absolute inset-x-0 top-0` against
 * the reader layout's `relative` container, the same anchor `ReaderTopBar`'s
 * own fullscreen `overlay` variant uses), so it never needs to touch
 * `ReaderTopBar.tsx` and never overlaps its two controls.
 *
 * `navigator.onLine` is asymmetric: a browser only ever reports `false` when
 * it is sure there is no link at all (radio off, airplane mode, adapter
 * down), so that side is trustworthy. It can still report `true` on a
 * captive portal or a dead upstream link — a false "online" — which this
 * component does not try to catch: proving connectivity would need a network
 * probe of its own, is out of scope for a cosmetic indicator, and the
 * asymmetry means silently trusting "online" degrades gracefully (the worst
 * case is staying quiet a little too long, never crying wolf).
 *
 * Reads `navigator.onLine` via `useSyncExternalStore` rather than
 * `useState` + `useEffect` — the same pattern `ThemeProvider` already uses
 * for its own browser-only external state (`localStorage` / `<html
 * data-theme>`): no risk of the "setState synchronously in an effect"
 * cascading-render footgun, and `getServerSnapshot` makes the SSR/hydration
 * story explicit (always "online") instead of implicit in effect timing.
 */

export interface OfflineIndicatorProps {
  /** Mirrors `ReaderTopBar`'s own `hidden` — fullscreen with the deck closed
   *  reclaims the whole screen, so this fades with it and returns when the
   *  deck (and the top bar) do. Stays mounted rather than unmounting, same
   *  reasoning as `ReaderTopBar`: nothing here affects layout either way. */
  hidden?: boolean;
}

function subscribeToConnectivity(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function isOfflineSnapshot(): boolean {
  try {
    return navigator.onLine === false;
  } catch {
    return false; // unknown — assume online rather than warning wrongly
  }
}

/** SSR has no `navigator` at all — never guess "offline" before hydration,
 *  or the badge would flash on every normal, connected load. */
function isOfflineServerSnapshot(): boolean {
  return false;
}

function NoConnectionIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-[calc(var(--leaf-dock-icon)-4px)] w-[calc(var(--leaf-dock-icon)-4px)]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5a16 16 0 0 1 6.6-3.4M14.4 5.1A16 16 0 0 1 21 8.5M6.2 12.4a11 11 0 0 1 4-2.1M13.8 10.3a11 11 0 0 1 2.9 1.4M9.5 16.2a5.5 5.5 0 0 1 5 0" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

export function OfflineIndicator({ hidden = false }: OfflineIndicatorProps) {
  const offline = useSyncExternalStore(
    subscribeToConnectivity,
    isOfflineSnapshot,
    isOfflineServerSnapshot,
  );

  if (!offline) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center [transition:opacity_var(--leaf-dur-ui)_var(--leaf-ease)]"
      style={{
        opacity: hidden ? 0 : 1,
        paddingTop: `calc(var(--leaf-reader-bar-pad-y) + var(--leaf-safe-top))`,
      }}
    >
      <p
        role="status"
        aria-live="polite"
        aria-label="You're offline. This book keeps working and your place is being saved on this device. The library needs a connection."
        className="flex items-center gap-[var(--leaf-space-2)] whitespace-nowrap rounded-pill border px-[var(--leaf-space-3)] font-mono uppercase [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-wide)]"
        style={{
          background: "var(--leaf-dock-bg)",
          borderColor: "var(--leaf-dock-border)",
          color: "var(--leaf-dock-text-muted)",
          height: "var(--leaf-dock-h)",
        }}
      >
        <NoConnectionIcon />
        <span aria-hidden>Offline — saved on this device</span>
      </p>
    </div>
  );
}
