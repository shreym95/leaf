// View-local show/hide state for the reader's top bar and dock on touch
// devices. It is never read on a fine pointer, so desktop keeps the bars as
// they are. Nothing here outlives the reader view.

import { useCallback, useState, useSyncExternalStore } from "react";
import { isCoarsePointer } from "./tap-policy";

const COARSE_QUERY = "(pointer: coarse)";

function subscribeCoarse(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia(COARSE_QUERY);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

/** Live `(pointer: coarse)`. The server render and hydration read a fine pointer. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribeCoarse, isCoarsePointer, () => false);
}

export interface BarsVisibility {
  /** Whether the bars are shown. Starts shown; only a touch reader ever hides them. */
  visible: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

export function useBarsVisibility(): BarsVisibility {
  const [visible, setVisible] = useState(true);
  const show = useCallback(() => setVisible(true), []);
  const hide = useCallback(() => setVisible(false), []);
  const toggle = useCallback(() => setVisible((v) => !v), []);
  return { visible, show, hide, toggle };
}
