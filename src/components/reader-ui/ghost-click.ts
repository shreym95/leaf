/**
 * Ghost-click guard for bar actions that fire on `pointerdown`.
 *
 * A bar action (Highlight, Note) acts on the press and unmounts the bar. The
 * browser still dispatches the `click` that belongs to that press, and by then
 * the element under the finger is the top bar's own row, so the click lands on
 * a link or button that was never meant to be tapped. Arming this guard swallows
 * the next click at the document, in the capture phase, before any target sees
 * it. It disarms on that click, or after the window lapses, whichever comes first.
 *
 * Two clicks are let through rather than swallowed: a keyboard activation
 * (`detail` 0), which never comes from a press, and a click on a control that is
 * still live in the top bar's slot (`[data-bar-slot]`), such as the ✕ on a
 * failure notice that replaced the bar. Neither is the press's ghost.
 */

export const GHOST_CLICK_WINDOW_MS = 500;

let disarmCurrent: (() => void) | null = null;

function isGhost(e: Event): boolean {
  if (!(e instanceof MouseEvent) || e.detail === 0) return false;
  const target = e.target;
  return !(target instanceof Element && target.closest("[data-bar-slot]") !== null);
}

export function swallowNextClick(): void {
  disarmCurrent?.();

  const handler = (e: Event) => {
    const ghost = isGhost(e);
    disarm();
    if (!ghost) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const timer = window.setTimeout(() => disarm(), GHOST_CLICK_WINDOW_MS);
  function disarm(): void {
    document.removeEventListener("click", handler, true);
    window.clearTimeout(timer);
    if (disarmCurrent === disarm) disarmCurrent = null;
  }

  document.addEventListener("click", handler, true);
  disarmCurrent = disarm;
}
