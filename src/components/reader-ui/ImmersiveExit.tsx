"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ImmersiveExit — the one control left on screen in immersive mode.
 *
 * Immersive hides every bar, so without this there is no way back on a touch
 * device (there is no `Esc` key on a phone, and the browser's back gesture would
 * leave the book, not the mode).
 *
 * It auto-hides, the way a video player's controls do. Full-bleed reading puts
 * the text under this button, and a permanent control sitting on top of a
 * chapter heading is exactly the intrusion immersive mode is meant to remove.
 * Tapping the middle of the page brings it back — the page-turn zones down each
 * edge keep working, and the reveal layer only exists while the button is
 * hidden, so it never swallows a text selection.
 *
 * Under `prefers-reduced-motion` the fade is instant (the duration token is 0),
 * but the timing still applies — this is a visibility affordance, not decoration.
 */

const HIDE_AFTER_MS = 2600;

export interface ImmersiveExitProps {
  visible: boolean;
  onExit: () => void;
}

export function ImmersiveExit({ visible, onExit }: ImmersiveExitProps) {
  const [showing, setShowing] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armHide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShowing(false), HIDE_AFTER_MS);
  }, []);

  const reveal = useCallback(() => {
    setShowing(true);
    armHide();
  }, [armHide]);

  // Entering immersive shows the way out, then lets it fade. The component is
  // remounted on each immersive change (keyed by the caller), so `showing`
  // starts true and this effect only has to arm the timer.
  useEffect(() => {
    if (!visible) return;
    armHide();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [visible, armHide]);

  const on = visible && showing;

  return (
    <>
      {/* Tap anywhere but the page-turn edges to bring the control back. Only
          mounted while it is hidden, so normal interaction is untouched. */}
      {visible && !showing && (
        <button
          type="button"
          aria-label="Show reading controls"
          onClick={reveal}
          className="fixed inset-y-0 left-[14%] right-[14%] z-30 cursor-default"
        />
      )}

      <button
        type="button"
        onClick={onExit}
        aria-label="Exit immersive reading"
        aria-hidden={!on}
        inert={!on}
        style={{
          top: `calc(var(--leaf-space-3) + var(--leaf-safe-top))`,
          left: `calc(var(--leaf-space-3) + var(--leaf-safe-left))`,
        }}
        className={
          "fixed z-40 flex h-10 w-10 items-center justify-center rounded-pill " +
          "border border-rule bg-page text-ink transition-opacity " +
          "[transition-duration:var(--leaf-dur-ui)] " +
          "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)] " +
          (on ? "opacity-90" : "opacity-0")
        }
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d="M15 5 8 12l7 7" />
        </svg>
      </button>
    </>
  );
}
