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
 * has acted, until that press has finished.
 *
 * Highlight and Note act on `pointerdown` and empty the slot. The browser still
 * dispatches the press's `click`, and by then the row that takes the slot's place
 * (the Library link) may be under the finger. So the hold keeps the bar's last
 * shown content mounted, frozen, with a transparent catcher over it. The click
 * lands on the catcher, not on the row. Whatever the action renders next (the
 * note field) mounts only once the hold releases.
 *
 * The hold releases one frame after the press's `click`, or one frame after the
 * `pointerup` or `pointercancel` of the arming pointer. While the arming pointer
 * is still down it never releases, except at PRESS_HOLD_CAP_MS after arming, which
 * releases regardless. Its listeners only observe; nothing is cancelled or
 * swallowed. Keyboard activations never arm it, so they act and leave at once.
 *
 * The arming pointer is the latest primary-button pointer seen by a window capture
 * `pointerdown` listener mounted with the provider; `arm()` reads it.
 *
 * The bar reaches the hold through context (`useBarPressArm`), so the shell
 * passes the live content in once and the bars need no extra props.
 */

export const PRESS_HOLD_CAP_MS = 3000;

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

  // The latest primary-button pointer, and the pointer that armed the hold.
  const latestPointerRef = useRef<number | undefined>(undefined);
  const armedPointerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const record = (e: PointerEvent) => {
      if (e.button === 0) latestPointerRef.current = e.pointerId;
    };
    window.addEventListener("pointerdown", record, true);
    return () => window.removeEventListener("pointerdown", record, true);
  }, []);

  const [hold, setHold] = useState<{ node: ReactNode } | null>(null);
  const holding = hold !== null;

  const arm = useCallback(() => {
    const node = liveRef.current;
    if (node === null || node === undefined) return;
    armedPointerRef.current = latestPointerRef.current;
    setHold((prev) => prev ?? { node });
  }, []);

  useEffect(() => {
    if (!holding) return;
    const release = () => setHold(null);
    let frame: number | undefined;
    const settle = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(release);
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerId === armedPointerRef.current) settle();
    };
    const cap = setTimeout(release, PRESS_HOLD_CAP_MS);
    window.addEventListener("pointerup", onPointerEnd, true);
    window.addEventListener("pointercancel", onPointerEnd, true);
    window.addEventListener("click", settle, true);
    return () => {
      window.removeEventListener("pointerup", onPointerEnd, true);
      window.removeEventListener("pointercancel", onPointerEnd, true);
      window.removeEventListener("click", settle, true);
      clearTimeout(cap);
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
