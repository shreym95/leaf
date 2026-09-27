"use client";

import { useSyncExternalStore } from "react";

/**
 * useIsOffline — shared connectivity read, extracted from `OfflineIndicator`
 * (Stage 4 offline reading, part 3) when `OfflineShelf` needed the exact same
 * live signal for defect 3 (giving `/offline` a way out once the network
 * returns). Pulled into `src/components/ui` — the existing home for
 * cross-feature shared UI plumbing that isn't design tokens or a primitive
 * (`AccountMenu`, `Skeleton`), rather than either `-ui` folder importing from
 * the other (`reader-ui` and `offline-ui` are sibling feature folders; a
 * hook one needs living inside the other's directory would be a false
 * dependency neither actually has on the other's feature).
 *
 * `navigator.onLine` is asymmetric: a browser only ever reports `false` when
 * it is sure there is no link at all (radio off, airplane mode, adapter
 * down), so that side is trustworthy. It can still report `true` on a
 * captive portal or a dead upstream link — a false "online" — which this
 * hook does not try to catch: proving connectivity would need a network
 * probe of its own, and every current caller already degrades gracefully if
 * "online" is occasionally optimistic (worst case: staying quiet, or showing
 * a still-unreachable link, a little too long — never crying wolf).
 *
 * Reads `navigator.onLine` via `useSyncExternalStore` rather than
 * `useState` + `useEffect` — the same pattern `ThemeProvider` already uses
 * for its own browser-only external state: no risk of the "setState
 * synchronously in an effect" cascading-render footgun, and
 * `getServerSnapshot` makes the SSR/hydration story explicit (always
 * "online") instead of implicit in effect timing.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getSnapshot(): boolean {
  try {
    return navigator.onLine === false;
  } catch {
    return false; // unknown — assume online rather than warning wrongly
  }
}

/** SSR has no `navigator` at all — never guess "offline" before hydration,
 *  or a caller would flash an offline-only UI on every normal, connected
 *  load. */
function getServerSnapshot(): boolean {
  return false;
}

/** `true` once `navigator.onLine` is confidently `false`; `false` on the
 *  server, before hydration, and whenever the browser isn't SURE there's no
 *  link (see the module header on the asymmetry). Live: re-renders on the
 *  browser's own `online` / `offline` events. */
export function useIsOffline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
