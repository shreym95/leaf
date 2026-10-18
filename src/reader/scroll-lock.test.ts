// Selection scroll lock — the page view stays on the current page while the
// reader selects text. The scroller and the book iframe are plain DOM objects:
// `scrollLeft` is backed by an explicit store, and every scroll, selection and
// pointer event is a real dispatched event, so the lock's listeners run for real.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createScrollLock } from "./scroll-lock";
import type { ScrollLock } from "./scroll-lock";

const PAGE = 409;

// A scroller whose `scrollLeft` is a plain store, so a test can move it the way
// the browser would and then dispatch the `scroll` event the browser fires.
function makeScroller(): HTMLElement {
  const el = document.createElement("div");
  let left = 0;
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    get: () => left,
    set: (v: number) => {
      left = v;
    },
  });
  return el;
}

function scrollTo(el: HTMLElement, left: number): void {
  el.scrollLeft = left;
  el.dispatchEvent(new Event("scroll"));
}

// A book iframe document with a window whose selection and scroll the test drives.
function makeBookDocument() {
  const doc = document.implementation.createHTMLDocument("book");
  const sel = { rangeCount: 0, isCollapsed: true, text: "" };
  const pos = { x: 0, y: 0 };
  const win = {
    getSelection: () => ({
      rangeCount: sel.rangeCount,
      isCollapsed: sel.isCollapsed,
      toString: () => sel.text,
    }),
    get scrollX() {
      return pos.x;
    },
    get scrollY() {
      return pos.y;
    },
    scrollTo: vi.fn((x: number, y: number) => {
      pos.x = x;
      pos.y = y;
    }),
  };
  Object.defineProperty(doc, "defaultView", { value: win, configurable: true });
  return {
    doc,
    win,
    select(text: string): void {
      sel.rangeCount = 1;
      sel.isCollapsed = false;
      sel.text = text;
      doc.dispatchEvent(new Event("selectionchange"));
    },
    collapse(): void {
      sel.rangeCount = 1;
      sel.isCollapsed = true;
      sel.text = "";
      doc.dispatchEvent(new Event("selectionchange"));
    },
    scrollWindow(x: number, y: number): void {
      pos.x = x;
      pos.y = y;
      doc.dispatchEvent(new Event("scroll"));
    },
    pointerDown(): void {
      doc.dispatchEvent(new Event("pointerdown"));
    },
    pointerUp(): void {
      doc.dispatchEvent(new Event("pointerup"));
    },
  };
}

const lockUnderTest: { current?: ScrollLock } = {};

function setup() {
  const host = document.createElement("div");
  const scroller = makeScroller();
  host.appendChild(scroller);
  const lock = createScrollLock({ scroller: () => scroller, host });
  lockUnderTest.current = lock;
  const book = makeBookDocument();
  return { host, scroller, lock, ...book };
}

afterEach(() => {
  lockUnderTest.current?.destroy();
  lockUnderTest.current = undefined;
});

describe("selection scroll lock", () => {
  it("reverts an unrequested scroll to the page offset while a selection holds text", () => {
    const { scroller, lock, doc, select } = setup();
    lock.watchDocument(doc);
    scrollTo(scroller, 2 * PAGE); // page 3, recorded by an idle relocation
    lock.onRelocated();

    select("a passage");
    scrollTo(scroller, 2 * PAGE + 200); // the browser auto-scrolled the handle's edge

    expect(scroller.scrollLeft).toBe(2 * PAGE);
  });

  it("leaves a scroll alone with no selection and no pointer down", () => {
    const { scroller, lock, doc } = setup();
    lock.watchDocument(doc);
    scrollTo(scroller, 2 * PAGE);
    lock.onRelocated();

    scrollTo(scroller, 2 * PAGE + 200);

    expect(scroller.scrollLeft).toBe(2 * PAGE + 200);
  });

  it("treats a pointer held down in the book as a lock, and releasing it ends the lock", () => {
    const { scroller, lock, doc, pointerDown, pointerUp } = setup();
    lock.watchDocument(doc);
    scrollTo(scroller, 2 * PAGE);
    lock.onRelocated();

    pointerDown();
    scrollTo(scroller, 2 * PAGE + 200);
    expect(scroller.scrollLeft).toBe(2 * PAGE);

    pointerUp();
    scrollTo(scroller, 2 * PAGE + 200);
    expect(scroller.scrollLeft).toBe(2 * PAGE + 200);
  });

  it("restores a drifted page offset when the selection clears", () => {
    const { scroller, lock, doc, select, collapse } = setup();
    lock.watchDocument(doc);
    scrollTo(scroller, 2 * PAGE);
    lock.onRelocated();

    select("a passage");
    scroller.scrollLeft = 2 * PAGE + 300; // drift with no scroll event delivered
    collapse();

    expect(scroller.scrollLeft).toBe(2 * PAGE);
  });

  it("never reverts an engine move, and records the offset it lands on", () => {
    const { scroller, lock, doc, select } = setup();
    lock.watchDocument(doc);
    scrollTo(scroller, 0);
    lock.onRelocated();
    select("a passage");

    const end = lock.beginMove();
    scrollTo(scroller, 3 * PAGE); // the engine's own page turn, mid-selection
    expect(scroller.scrollLeft).toBe(3 * PAGE);
    end();
    end(); // a second call must not end a move that is no longer in flight

    scrollTo(scroller, 3 * PAGE + 50); // a later drift is measured from the landing
    expect(scroller.scrollLeft).toBe(3 * PAGE);
  });

  it("does not record a drifted position from a relocation while locked", () => {
    const { scroller, lock, doc, select, collapse } = setup();
    lock.watchDocument(doc);
    scrollTo(scroller, 2 * PAGE);
    lock.onRelocated();

    select("a passage");
    scroller.scrollLeft = 2 * PAGE + 300; // drift the scroll event has not reached yet
    lock.onRelocated(); // epub.js reports the drifted position while locked
    collapse();

    expect(scroller.scrollLeft).toBe(2 * PAGE);
  });

  it("ignores sub-pixel drift from device-pixel snapping", () => {
    const { scroller, lock, doc, select } = setup();
    lock.watchDocument(doc);
    scrollTo(scroller, 2 * PAGE);
    lock.onRelocated();

    select("a passage");
    scrollTo(scroller, 2 * PAGE + 0.5);

    expect(scroller.scrollLeft).toBe(2 * PAGE + 0.5);
  });

  it("reverts a scroll of the book iframe window while locked", () => {
    const { lock, doc, win, select, scrollWindow } = setup();
    lock.watchDocument(doc);
    select("a passage");

    scrollWindow(0, 120);

    expect(win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("stops listening after destroy", () => {
    const { scroller, lock, doc, select } = setup();
    lock.watchDocument(doc);
    scrollTo(scroller, 2 * PAGE);
    lock.onRelocated();
    select("a passage");

    lock.destroy();
    scrollTo(scroller, 2 * PAGE + 200);

    expect(scroller.scrollLeft).toBe(2 * PAGE + 200);
  });

  it("forgets a book document whose window is gone", () => {
    const { scroller, lock, doc, select } = setup();
    lock.watchDocument(doc);
    scrollTo(scroller, 2 * PAGE);
    lock.onRelocated();
    select("a passage");

    Object.defineProperty(doc, "defaultView", { value: null, configurable: true });
    lock.prune();
    scrollTo(scroller, 2 * PAGE + 200);

    expect(scroller.scrollLeft).toBe(2 * PAGE + 200);
  });
});
