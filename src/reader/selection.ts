// DOM plumbing for the reader engine's selection and tap events. Kept apart from
// engine.ts so the engine keeps its epub.js wiring and this stays testable on
// plain DOM objects. Style-agnostic: no design or component imports.

/** Pointer travel (CSS px) beyond which a click is the end of a drag, not a tap. */
export const DRAG_SLOP_PX = 10;

export interface Point {
  x: number;
  y: number;
}

/** True when the window holds a non-collapsed selection with visible text. Never throws. */
export function selectionHasText(win: Window | null | undefined): boolean {
  try {
    const sel = win?.getSelection?.();
    return (
      !!sel &&
      sel.rangeCount > 0 &&
      !sel.isCollapsed &&
      sel.toString().length > 0
    );
  } catch {
    return false;
  }
}

/** True when the pointer travelled further than `DRAG_SLOP_PX` from down to up. */
export function isDragGesture(down: Point, up: Point): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) > DRAG_SLOP_PX;
}

export interface IframeDocumentHooks {
  /** A selection that held text has gone empty. Fires once per collapse. */
  onSelectionCollapsed(): void;
  /** A pointer went down inside the document (iframe-relative coordinates). */
  onPointerDown(at: Point): void;
}

/**
 * Watches a book iframe document for selection collapses and pointer-downs.
 * epub.js's `selected` only fires for non-collapsed ranges, so a collapse is
 * invisible to it and has to be read from the document directly. Returns the
 * detach function that removes both listeners.
 */
export function watchIframeDocument(
  doc: Document,
  hooks: IframeDocumentHooks,
): () => void {
  let selectionWasActive = false;

  const onSelectionChange = (): void => {
    if (selectionHasText(doc.defaultView)) {
      selectionWasActive = true;
      return;
    }
    if (!selectionWasActive) return;
    selectionWasActive = false;
    try {
      hooks.onSelectionCollapsed();
    } catch {
      // a bad hook must not reach the browser's event dispatch
    }
  };

  const onPointerDown = (ev: Event): void => {
    const me = ev as MouseEvent;
    try {
      hooks.onPointerDown({ x: me.clientX, y: me.clientY });
    } catch {
      // a bad hook must not reach the browser's event dispatch
    }
  };

  doc.addEventListener("selectionchange", onSelectionChange, { passive: true });
  doc.addEventListener("pointerdown", onPointerDown, { passive: true });

  return () => {
    doc.removeEventListener("selectionchange", onSelectionChange);
    doc.removeEventListener("pointerdown", onPointerDown);
  };
}
