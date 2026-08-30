"use client";

/**
 * ImmersiveExit — the one control left on screen in immersive mode.
 *
 * Immersive hides every bar, so without this there is no way back on a touch
 * device (there is no `Esc` key on a phone, and the browser's own back gesture
 * would leave the book, not the mode). It sits in the top-left over the page,
 * deliberately quiet — low contrast until touched — so it reads as an escape
 * hatch rather than chrome.
 *
 * It is `fixed`, not inside the frame, so it survives the page going full-bleed.
 */

export interface ImmersiveExitProps {
  visible: boolean;
  onExit: () => void;
}

export function ImmersiveExit({ visible, onExit }: ImmersiveExitProps) {
  return (
    <button
      type="button"
      onClick={onExit}
      aria-label="Exit immersive reading"
      aria-hidden={!visible}
      inert={!visible}
      className={
        "fixed left-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-pill " +
        "border border-rule bg-page text-ink-mid transition-opacity " +
        "[transition-duration:var(--leaf-dur-ui)] hover:text-ink " +
        "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)] " +
        (visible ? "opacity-60 hover:opacity-100" : "opacity-0")
      }
    >
      {/* Back arrow. Sized in em so it tracks the button's font size. */}
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
  );
}
