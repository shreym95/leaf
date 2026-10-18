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
// Moves the engine does not start itself (epub.js re-displaying on resize, an
// in-book link tap) are bracketed where the engine wraps epub.js's manager
// display (`rendition.manager.display`), which every page move goes through.
// A viewport change (window resize, fullscreen, orientation change) ends any
// held pointer, and the view is treated as moving until epub.js relocates it:
// the offset it lands on becomes the page to hold.
//
// Style-agnostic, no design or component imports (ESLint seam rule).

import { selectionHasText } from "./selection";

/**
 * Sub-pixel tolerance in CSS px. On a fractional-DPR device the browser snaps
 * every scroll offset to whole device pixels (see `undriftForNextPage` in
 * engine.ts), so an exact comparison would revert a fraction of a pixel forever.
 */
const TOLERANCE_PX = 1;

/**
 * Longest a move bracket may stay open. A display() whose promise never settles
 * would otherwise hold the lock off for good, so the bracket is released here.
 */
const MOVE_CAP_MS = 5000;

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
   * returned function more than once is a no-op. A move still open after
   * `MOVE_CAP_MS` is released by the lock itself.
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
  // The watched document that holds `pointerDown`, so prune can release it when
  // that document is removed and its pointerup will never arrive.
  let pointerHolder: Document | undefined;
  // Engine moves in flight. Scrolls during a move are the engine's own.
  let moves = 0;
  // Safety-cap timers of the moves in flight, cleared on destroy.
  const moveTimers = new Set<ReturnType<typeof setTimeout>>();
  // Bumped on destroy. A move begun before destroy must not touch the count
  // afterwards, so its end() is a no-op once the generation has moved on.
  let generation = 0;
  // A viewport change happened and epub.js has not relocated since. Its
  // re-layout scrolls are not drift, so nothing is reverted until it relocates.
  let awaitingRelocation = false;
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

  // The view is epub.js's own to move: an engine move is in flight, or a viewport
  // change has not been followed by a relocation yet.
  function viewMoving(): boolean {
    return moves > 0 || awaitingRelocation;
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
    if (wasLocked && !now && !viewMoving()) revertScroller();
    wasLocked = now;
  }

  function onHostScroll(ev: Event): void {
    if (viewMoving() || !locked()) return;
    if (ev.target !== opts.scroller()) return;
    revertScroller();
  }

  function onPointerDown(doc: Document): void {
    pointerDown = true;
    pointerHolder = doc;
    settle();
  }

  function onPointerUp(): void {
    if (!pointerDown) return;
    pointerDown = false;
    pointerHolder = undefined;
    settle();
  }

  // A resize, fullscreen or orientation change makes epub.js re-display and the
  // browser re-lay out the page, and the pointer that was down may have been
  // lost with the layout change. Hold nothing until epub.js relocates.
  function onViewportChange(): void {
    pointerDown = false;
    pointerHolder = undefined;
    awaitingRelocation = true;
    settle();
  }

  // Released outside the iframe (a handle dragged onto the page chrome), so the
  // parent document listens too.
  parentDoc.addEventListener("pointerup", onPointerUp, { passive: true });
  parentDoc.addEventListener("pointercancel", onPointerUp, { passive: true });
  parentDoc.addEventListener("fullscreenchange", onViewportChange, { passive: true });
  const parentWin = parentDoc.defaultView;
  parentWin?.addEventListener("resize", onViewportChange, { passive: true });
  // epub.js resizes on `orientationchange` synchronously, and its clear() resets
  // the scroller before any `resize` the browser may or may not send.
  parentWin?.addEventListener("orientationchange", onViewportChange, { passive: true });
  // The Screen Orientation API reports the same rotation where it exists.
  const screenOrientation: ScreenOrientation | undefined = parentWin?.screen.orientation;
  screenOrientation?.addEventListener("change", onViewportChange, { passive: true });
  opts.host.addEventListener("scroll", onHostScroll, { capture: true, passive: true });

  function watchDocument(doc: Document): void {
    prune();
    if (docs.has(doc)) return;
    const win = doc.defaultView;
    if (win && !baselines.has(win)) {
      baselines.set(win, { x: win.scrollX, y: win.scrollY });
    }
    const onDocPointerDown = (): void => onPointerDown(doc);
    const onWindowScroll = (): void => {
      if (viewMoving() || !locked()) return;
      revertWindow(doc);
    };
    doc.addEventListener("selectionchange", settle, { passive: true });
    doc.addEventListener("pointerdown", onDocPointerDown, { passive: true });
    doc.addEventListener("pointerup", onPointerUp, { passive: true });
    doc.addEventListener("pointercancel", onPointerUp, { passive: true });
    doc.addEventListener("scroll", onWindowScroll, { passive: true });
    docs.set(doc, () => {
      doc.removeEventListener("selectionchange", settle);
      doc.removeEventListener("pointerdown", onDocPointerDown);
      doc.removeEventListener("pointerup", onPointerUp);
      doc.removeEventListener("pointercancel", onPointerUp);
      doc.removeEventListener("scroll", onWindowScroll);
      if (win) baselines.delete(win);
    });
  }

  function prune(): void {
    let heldPointer = false;
    for (const [doc, detach] of docs) {
      if (doc.defaultView) continue;
      detach();
      docs.delete(doc);
      if (pointerHolder === doc) heldPointer = true;
    }
    // The pointer went down in a document that is gone: its pointerup can never
    // arrive, so the pointer is released here.
    if (heldPointer) {
      pointerDown = false;
      pointerHolder = undefined;
      settle();
    }
  }

  return {
    beginMove(): () => void {
      moves += 1;
      // Whether this move still counts in `moves`. The cap can release it before
      // the caller's end() arrives, and that later end must not count it twice.
      let counted = true;
      let ended = false;
      const begunIn = generation;
      const uncount = (): void => {
        if (!counted) return;
        counted = false;
        moves -= 1;
      };
      // The landing is recorded only once no move is in flight: an open move
      // would otherwise record an offset it has not reached yet.
      const recordIfIdle = (): void => {
        if (moves === 0) recordPage();
      };
      const timer = setTimeout(() => {
        moveTimers.delete(timer);
        uncount();
        recordIfIdle();
      }, MOVE_CAP_MS);
      moveTimers.add(timer);
      return (): void => {
        if (ended || begunIn !== generation) return;
        ended = true;
        clearTimeout(timer);
        moveTimers.delete(timer);
        uncount();
        // Also after a cap release: a display that settles late still lands
        // where the lock must hold, so the landing replaces the capped offset.
        recordIfIdle();
      };
    },

    watchDocument,

    onRelocated(): void {
      if (moves !== 0) return;
      if (awaitingRelocation || !locked()) {
        awaitingRelocation = false;
        recordPage();
      }
    },

    prune,

    destroy(): void {
      opts.host.removeEventListener("scroll", onHostScroll, { capture: true });
      parentDoc.removeEventListener("pointerup", onPointerUp);
      parentDoc.removeEventListener("pointercancel", onPointerUp);
      parentDoc.removeEventListener("fullscreenchange", onViewportChange);
      parentWin?.removeEventListener("resize", onViewportChange);
      parentWin?.removeEventListener("orientationchange", onViewportChange);
      screenOrientation?.removeEventListener("change", onViewportChange);
      for (const detach of docs.values()) detach();
      docs.clear();
      baselines.clear();
      for (const timer of moveTimers) clearTimeout(timer);
      moveTimers.clear();
      generation += 1;
      moves = 0;
      pointerDown = false;
      pointerHolder = undefined;
      awaitingRelocation = false;
      wasLocked = false;
      page = undefined;
    },
  };
}
