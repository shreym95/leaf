// Selection scroll lock. While the reader is selecting text, the page view must
// stay on the current page: the browser auto-scrolls the nearest scrollable
// ancestor to keep a dragged selection handle visible, and that scroll moves
// epub.js's paginated scroller off the page boundary (a page sliding sideways
// by part of a page, on Android Chrome). Nothing in epub.js restores it.
//
// The lock reverts any scroll that was not requested by the engine while a
// selection holds text or a pointer is down. The page offset it restores is the
// one recorded at the last settled move (engine navigation or an idle
// relocation). Engine moves are bracketed by `beginMove()`, so their scrolls are
// never reverted. Selections may still extend past the page edge: the lock
// stops the view moving, not the selection growing.
//
// Style-agnostic, no design or component imports (ESLint seam rule).

import { selectionHasText } from "./selection";

/**
 * Sub-pixel tolerance in CSS px. On a fractional-DPR device the browser snaps
 * every scroll offset to whole device pixels (see `undriftForNextPage` in
 * engine.ts), so an exact comparison would revert a fraction of a pixel forever.
 */
const TOLERANCE_PX = 1;

export interface ScrollLockOptions {
  /**
   * The element epub.js scrolls (`rendition.manager.container`). Resolved on
   * use: epub.js creates it asynchronously, after `renderTo`.
   */
  scroller(): HTMLElement | undefined;
  /**
   * The element that holds the scroller. Scroll events do not bubble, so the
   * lock listens for them in the capture phase here.
   */
  host: HTMLElement;
}

export interface ScrollLock {
  /**
   * Marks an engine-initiated move. Scrolls are not reverted until the returned
   * function is called, which also records the landing offset. Calling the
   * returned function more than once is a no-op.
   */
  beginMove(): () => void;
  /** Watches a book iframe document for selection, pointer and scroll. Idempotent. */
  watchDocument(doc: Document): void;
  /** Call on every epub.js relocation. Records the page offset only while idle. */
  onRelocated(): void;
  /** Detaches documents epub.js has removed (their window is gone). */
  prune(): void;
  destroy(): void;
}

export function createScrollLock(opts: ScrollLockOptions): ScrollLock {
  // Container scrollLeft of the current page. Undefined until the first settle.
  let page: number | undefined;
  // Scroll position of each watched iframe window at its last settled move.
  const baselines = new Map<Window, { x: number; y: number }>();
  // Per watched document: the detach function for its listeners.
  const docs = new Map<Document, () => void>();
  // A pointer is down inside a watched document (or anywhere, until released).
  let pointerDown = false;
  // Engine moves in flight. Scrolls during a move are the engine's own.
  let moves = 0;
  // Whether the lock was engaged at the last settle, to detect the release edge.
  let wasLocked = false;

  const parentDoc = opts.host.ownerDocument;

  function selectionActive(): boolean {
    for (const doc of docs.keys()) {
      if (selectionHasText(doc.defaultView)) return true;
    }
    return false;
  }

  function locked(): boolean {
    return pointerDown || selectionActive();
  }

  function recordPage(): void {
    const scroller = opts.scroller();
    if (scroller) page = scroller.scrollLeft;
    for (const doc of docs.keys()) {
      const win = doc.defaultView;
      if (win) baselines.set(win, { x: win.scrollX, y: win.scrollY });
    }
  }

  function revertScroller(): void {
    const scroller = opts.scroller();
    if (!scroller || page === undefined) return;
    if (Math.abs(scroller.scrollLeft - page) > TOLERANCE_PX) {
      scroller.scrollLeft = page;
    }
  }

  function revertWindow(doc: Document): void {
    const win = doc.defaultView;
    const base = win ? baselines.get(win) : undefined;
    if (!win || !base) return;
    if (
      Math.abs(win.scrollX - base.x) > TOLERANCE_PX ||
      Math.abs(win.scrollY - base.y) > TOLERANCE_PX
    ) {
      win.scrollTo(base.x, base.y);
    }
  }

  // Runs on every lock-state change. The release edge restores a drift that
  // was not caught while locked. The restore is tied to the edge, not to every
  // settle, so an unlocked scroll that epub.js has not yet reported is not
  // mistaken for drift.
  function settle(): void {
    const now = locked();
    if (wasLocked && !now && moves === 0) revertScroller();
    wasLocked = now;
  }

  function onHostScroll(ev: Event): void {
    if (moves > 0 || !locked()) return;
    if (ev.target !== opts.scroller()) return;
    revertScroller();
  }

  function onPointerDown(): void {
    pointerDown = true;
    settle();
  }

  function onPointerUp(): void {
    if (!pointerDown) return;
    pointerDown = false;
    settle();
  }

  // Released outside the iframe (a handle dragged onto the page chrome), so the
  // parent document listens too.
  parentDoc.addEventListener("pointerup", onPointerUp, { passive: true });
  parentDoc.addEventListener("pointercancel", onPointerUp, { passive: true });
  opts.host.addEventListener("scroll", onHostScroll, { capture: true, passive: true });

  function watchDocument(doc: Document): void {
    prune();
    if (docs.has(doc)) return;
    const win = doc.defaultView;
    if (win && !baselines.has(win)) {
      baselines.set(win, { x: win.scrollX, y: win.scrollY });
    }
    const onWindowScroll = (): void => {
      if (moves > 0 || !locked()) return;
      revertWindow(doc);
    };
    doc.addEventListener("selectionchange", settle, { passive: true });
    doc.addEventListener("pointerdown", onPointerDown, { passive: true });
    doc.addEventListener("pointerup", onPointerUp, { passive: true });
    doc.addEventListener("pointercancel", onPointerUp, { passive: true });
    doc.addEventListener("scroll", onWindowScroll, { passive: true });
    docs.set(doc, () => {
      doc.removeEventListener("selectionchange", settle);
      doc.removeEventListener("pointerdown", onPointerDown);
      doc.removeEventListener("pointerup", onPointerUp);
      doc.removeEventListener("pointercancel", onPointerUp);
      doc.removeEventListener("scroll", onWindowScroll);
      if (win) baselines.delete(win);
    });
  }

  function prune(): void {
    for (const [doc, detach] of docs) {
      if (doc.defaultView) continue;
      detach();
      docs.delete(doc);
    }
  }

  return {
    beginMove(): () => void {
      moves += 1;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        moves -= 1;
        recordPage();
      };
    },

    watchDocument,

    onRelocated(): void {
      if (moves === 0 && !locked()) recordPage();
    },

    prune,

    destroy(): void {
      opts.host.removeEventListener("scroll", onHostScroll, { capture: true });
      parentDoc.removeEventListener("pointerup", onPointerUp);
      parentDoc.removeEventListener("pointercancel", onPointerUp);
      for (const detach of docs.values()) detach();
      docs.clear();
      baselines.clear();
      pointerDown = false;
      wasLocked = false;
      page = undefined;
    },
  };
}
