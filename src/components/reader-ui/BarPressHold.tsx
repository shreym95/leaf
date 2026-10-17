"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * BarPressHold: keeps the top bar's slot under the finger after a pointer press
 * has acted, until that press's own click has passed.
 *
 * Highlight and Note act on `pointerdown` and empty the slot. The browser still
 * dispatches the press's `click`, and by then the row that takes the slot's place
 * (the Library link) may be under the finger. So the hold keeps the bar's last
 * shown content mounted, frozen, with a transparent catcher over it. The click
 * lands on the catcher, not on the row. Whatever the action renders next (the
 * note field) mounts only once the hold releases.
 *
 * The hold releases one frame after the press's `click` or `pointerup`, or after
 * PRESS_HOLD_FALLBACK_MS when neither comes. Its listeners only observe; nothing
 * is cancelled or swallowed. Keyboard activations never arm it, so they act and
 * leave at once, as before.
 *
 * The bar reaches the hold through context (`useBarPressArm`), so the shell
 * passes the live content in once and the bars need no extra props.
 */

export const PRESS_HOLD_FALLBACK_MS = 400;

const noop = () => {};
const ArmContext = createContext<(() => void) | null>(null);

/** Arms the hold for the current press. A no-op outside a BarPressHold. */
export function useBarPressArm(): () => void {
  return useContext(ArmContext) ?? noop;
}

export interface BarPressHoldProps {
  /** The bar's content as it stands; null when no bar is up. */
  live: ReactNode;
  /** Receives what the slot should show: the frozen bar while held, else `live`. */
  children: (shown: ReactNode) => ReactNode;
}

export function BarPressHold({ live, children }: BarPressHoldProps) {
  // The content as last committed. `arm` runs on a pointer event, after the
  // commit that showed the bar, and before the action empties the slot.
  const liveRef = useRef<ReactNode>(live);
  useEffect(() => {
    liveRef.current = live;
  });

  const [hold, setHold] = useState<{ node: ReactNode } | null>(null);
  const holding = hold !== null;

  const arm = useCallback(() => {
    const node = liveRef.current;
    if (node === null || node === undefined) return;
    setHold((prev) => prev ?? { node });
  }, []);

  useEffect(() => {
    if (!holding) return;
    const release = () => setHold(null);
    let frame: number | undefined;
    const timer = setTimeout(release, PRESS_HOLD_FALLBACK_MS);
    const settle = () => {
      if (frame !== undefined) return;
      clearTimeout(timer);
      frame = requestAnimationFrame(release);
    };
    window.addEventListener("pointerup", settle, true);
    window.addEventListener("click", settle, true);
    return () => {
      window.removeEventListener("pointerup", settle, true);
      window.removeEventListener("click", settle, true);
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [holding]);

  const shown = hold ? <HeldBar>{hold.node}</HeldBar> : live;
  return <ArmContext.Provider value={arm}>{children(shown)}</ArmContext.Provider>;
}

/** The frozen bar, with a transparent catcher over it that takes the press's click. */
function HeldBar({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-full w-full min-w-0">
      {children}
      <span aria-hidden className="absolute inset-0" />
    </div>
  );
}
