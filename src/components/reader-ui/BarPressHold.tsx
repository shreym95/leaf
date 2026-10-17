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
 * The hold releases one frame after the press's `click`, or one frame after every
 * armed pointer is up (`pointerup`, `pointercancel` or `lostpointercapture`). A
 * window `blur` or the page turning hidden releases it at once. While any pointer
 * is down the hold has no timer. Only an armed hold that never saw a pointer go
 * down is capped, at PRESS_HOLD_CAP_MS, so it cannot stick. Its listeners only
 * observe; nothing is cancelled or swallowed. Keyboard activations never arm it,
 * so they act and leave at once.
 *
 * Armed pointers are kept as a set: a second finger that arms the hold does not
 * strand the first, and the hold releases only when all of them are up. The
 * primary-button pointers that are down are tracked by window capture listeners
 * mounted with the provider; `arm()` adds the latest one to the armed set.
 *
 * The bar reaches the hold through context (`useBarPressArm`), so the shell
 * passes the live content in once and the bars need no extra props.
 */

/** Cap for an armed hold with no pointer seen down. Never applies while a finger is down. */
export const PRESS_HOLD_CAP_MS = 10000;

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

  // The latest primary-button pointer, the primary pointers now down, and the
  // pointers that armed the hold.
  const latestPointerRef = useRef<number | undefined>(undefined);
  const [down] = useState(() => new Set<number | undefined>());
  const [armed] = useState(() => new Set<number | undefined>());
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      latestPointerRef.current = e.pointerId;
      down.add(e.pointerId);
    };
    const onUp = (e: PointerEvent) => {
      down.delete(e.pointerId);
    };
    // A blur or a hidden page can swallow the pointer-up that would clear a pointer.
    const forgetDown = () => down.clear();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") forgetDown();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("blur", forgetDown);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("blur", forgetDown);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [down]);

  const [hold, setHold] = useState<{ node: ReactNode } | null>(null);
  const holding = hold !== null;

  const arm = useCallback(() => {
    const node = liveRef.current;
    if (node === null || node === undefined) return;
    armed.add(latestPointerRef.current);
    setHold((prev) => prev ?? { node });
  }, [armed]);

  useEffect(() => {
    if (!holding) return;
    // Set once an armed pointer lifts while another is still armed.
    let lifted = false;
    let frame: number | undefined;
    let cap: number | undefined;

    const drop = () => {
      armed.clear();
      setHold(null);
    };
    const settle = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(drop);
    };
    const lift = (id: number | undefined) => {
      if (!armed.has(id)) return;
      armed.delete(id);
      if (armed.size === 0) settle();
      else lifted = true;
    };
    // Armed with no pointer down: the pointer-down was never seen, so cap the hold.
    const syncCap = () => {
      const idle = down.size === 0 && armed.size > 0;
      if (idle && cap === undefined) {
        cap = window.setTimeout(drop, PRESS_HOLD_CAP_MS);
      } else if (!idle && cap !== undefined) {
        window.clearTimeout(cap);
        cap = undefined;
      }
    };
    const onDown = () => syncCap();
    const onUp = (e: PointerEvent) => {
      lift(e.pointerId);
      syncCap();
    };
    const onLostCapture = (e: PointerEvent) => {
      lift(e.pointerId);
      syncCap();
    };
    // A click that follows one armed pointer's lift is that finger's; the hold
    // waits for the others. Any other click ends the press as before.
    const onClick = () => {
      if (armed.size === 0 || !lifted) settle();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") drop();
    };

    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("lostpointercapture", onLostCapture, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("blur", drop);
    document.addEventListener("visibilitychange", onHidden);
    syncCap();
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("lostpointercapture", onLostCapture, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("blur", drop);
      document.removeEventListener("visibilitychange", onHidden);
      window.clearTimeout(cap);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [holding, armed, down]);

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
