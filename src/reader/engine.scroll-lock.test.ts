// Selection scroll lock, wired through the reader engine. epub.js is mocked
// (same pattern as engine.selection.test.ts). The manager scroller and the book
// iframe are plain DOM objects, so the lock's listeners run for real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderContentSettings, ReaderController } from "./engine";

const PAGE = 409;

const { rendition, ePubFn } = vi.hoisted(() => {
  const themes = {
    font: vi.fn(),
    fontSize: vi.fn(),
    override: vi.fn(),
    default: vi.fn(),
  };
  const rendition = {
    themes,
    manager: undefined as unknown,
    display: vi.fn(async (_target?: string) => {}),
    on: vi.fn((_type: string, _cb: (...args: unknown[]) => void) => {}),
    spread: vi.fn((_spread: string) => {}),
    resize: vi.fn((_w: number, _h: number, _cfi?: string) => {}),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    annotations: { add: vi.fn(), remove: vi.fn() },
    getContents: vi.fn(() => [] as unknown[]),
    destroy: vi.fn(),
    currentLocation: vi.fn(() => ({
      start: {
        cfi: "epubcfi(/6/2!/4)",
        href: "text/part0003.html",
        displayed: { page: 1, total: 2 },
      },
    })),
  };
  const book = {
    ready: Promise.resolve(),
    loaded: { spine: Promise.resolve({ length: 12 }) },
    locations: {
      generate: vi.fn(async (): Promise<unknown[]> => []),
      percentageFromCfi: vi.fn(() => 0.5),
    },
    navigation: { toc: [] as unknown[] },
    spine: {
      get: vi.fn((_target: string) => null as { href?: string } | null),
    },
    renderTo: vi.fn(
      (_el: unknown, _opts: Record<string, unknown>) => rendition,
    ),
    destroy: vi.fn(),
  };
  const ePubFn = vi.fn((_data: unknown) => book);
  return { book, rendition, ePubFn };
});

vi.mock("epubjs", () => ({ default: ePubFn }));

vi.mock("./content-hook", () => ({
  registerContentPipeline: vi.fn(() =>
    Object.assign(() => {}, { refresh: vi.fn(), destroy: vi.fn() }),
  ),
}));

import { createReader } from "./engine";

const BASE_SETTINGS: ReaderContentSettings = {
  fontFamily: "serif",
  fontSize: 1.06,
  lineSpacing: 1.62,
  margins: "normal",
  theme: "day",
};

const RECT = (left: number, width: number) => ({
  left,
  top: 0,
  right: left + width,
  bottom: 600,
  width,
  height: 600,
  x: left,
  y: 0,
  toJSON: () => ({}),
});

// The scroller epub.js builds inside the container: its `scrollLeft` is a plain store.
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

// A rendered chapter: a real document whose window reports a selection the test controls.
function makeChapterDocument() {
  const doc = document.implementation.createHTMLDocument("book");
  const sel = { rangeCount: 0, isCollapsed: true, text: "" };
  const win = {
    getSelection: () => ({
      rangeCount: sel.rangeCount,
      isCollapsed: sel.isCollapsed,
      toString: () => sel.text,
      removeAllRanges: () => {
        sel.rangeCount = 0;
        sel.isCollapsed = true;
        sel.text = "";
      },
    }),
    scrollX: 0,
    scrollY: 0,
    scrollTo: vi.fn(),
    frameElement: { getBoundingClientRect: () => RECT(0, 1000) },
  } as unknown as Window & { frameElement?: unknown };
  Object.defineProperty(doc, "defaultView", { value: win, configurable: true });
  const select = (text: string) => {
    sel.rangeCount = 1;
    sel.isCollapsed = false;
    sel.text = text;
    doc.dispatchEvent(new Event("selectionchange"));
  };
  return { doc, select };
}

function handler(name: string): (...args: unknown[]) => void {
  const call = rendition.on.mock.calls.find((c) => c[0] === name);
  if (!call) throw new Error(`no rendition.on("${name}") registered`);
  return call[1] as (...args: unknown[]) => void;
}

const readers: ReaderController[] = [];
let scroller: HTMLElement;
// epub.js's page-move entry point. Every display (engine, link tap, resize) ends here.
let managerDisplay: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  scroller = makeScroller();
  managerDisplay = vi.fn(async (_target?: string) => {});
  rendition.manager = {
    container: scroller,
    layout: { delta: PAGE },
    display: managerDisplay,
  };
});

// A move epub.js starts itself: it reaches the manager, not the engine's API.
function epubMoves(target: string): Promise<unknown> {
  return (
    rendition.manager as { display: (t: string) => Promise<unknown> }
  ).display(target);
}

afterEach(() => {
  for (const r of readers.splice(0)) r.destroy();
});

async function readerAttached(): Promise<ReaderController> {
  const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
  const container = document.createElement("div");
  container.getBoundingClientRect = () => RECT(0, 1000);
  container.appendChild(scroller);
  await reader.attach(container);
  readers.push(reader);
  // The first relocation records page 1 as the offset the lock restores.
  handler("relocated")({ start: { cfi: "epubcfi(/6/2!/4)" }, atEnd: false });
  return reader;
}

describe("engine selection scroll lock", () => {
  it("does not revert a next() page turn made while a selection is active", async () => {
    const reader = await readerAttached();
    const { doc, select } = makeChapterDocument();
    handler("rendered")(null, { document: doc });
    select("a passage");

    rendition.next.mockImplementationOnce(async () => {
      scrollTo(scroller, PAGE);
    });
    await reader.next();
    expect(scroller.scrollLeft).toBe(PAGE);

    scrollTo(scroller, PAGE + 200); // drift after the turn is locked to page 2
    expect(scroller.scrollLeft).toBe(PAGE);
  });

  it("does not revert a prev() page turn made while a selection is active", async () => {
    const reader = await readerAttached();
    const { doc, select } = makeChapterDocument();
    handler("rendered")(null, { document: doc });
    scrollTo(scroller, 3 * PAGE);
    handler("relocated")({ start: { cfi: "epubcfi(/6/8!/4)" }, atEnd: false });
    select("a passage");

    rendition.prev.mockImplementationOnce(async () => {
      scrollTo(scroller, 2 * PAGE);
    });
    await reader.prev();
    expect(scroller.scrollLeft).toBe(2 * PAGE);

    scrollTo(scroller, 2 * PAGE + 200);
    expect(scroller.scrollLeft).toBe(2 * PAGE);
  });

  it("does not revert a goTo() jump made while a selection is active", async () => {
    const reader = await readerAttached();
    const { doc, select } = makeChapterDocument();
    handler("rendered")(null, { document: doc });
    select("a passage");

    rendition.display.mockImplementationOnce(async () => {
      scrollTo(scroller, 5 * PAGE);
    });
    await reader.goTo("text/part0007.html");
    expect(scroller.scrollLeft).toBe(5 * PAGE);

    scrollTo(scroller, 5 * PAGE + 200);
    expect(scroller.scrollLeft).toBe(5 * PAGE);
  });

  it("does not revert a display() epub.js starts itself while a selection is active", async () => {
    await readerAttached();
    const { doc, select } = makeChapterDocument();
    handler("rendered")(null, { document: doc });
    select("a passage");

    let finish!: () => void;
    managerDisplay.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    // Not the engine: a link tap or epub.js's re-display on resize goes to the manager.
    const pending = epubMoves("text/part0009.html");
    scrollTo(scroller, 4 * PAGE); // the view moves while the display is in flight
    expect(scroller.scrollLeft).toBe(4 * PAGE);

    finish();
    await pending;
    expect(scroller.scrollLeft).toBe(4 * PAGE); // not reverted at release

    scrollTo(scroller, 4 * PAGE + 200); // a later drift is held to the landing
    expect(scroller.scrollLeft).toBe(4 * PAGE);
  });

  it("releases a display() that never settles after 5000 ms", async () => {
    await readerAttached();
    const { doc, select } = makeChapterDocument();
    handler("rendered")(null, { document: doc });
    select("a passage");

    vi.useFakeTimers();
    try {
      managerDisplay.mockImplementationOnce(() => new Promise<void>(() => {}));
      void epubMoves("text/part0009.html");
      scrollTo(scroller, 4 * PAGE);

      vi.advanceTimersByTime(5000); // the bracket's safety cap
      scrollTo(scroller, 4 * PAGE + 200); // no move is in flight any more
      expect(scroller.scrollLeft).toBe(4 * PAGE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("locks the view for a selection made in a rendered chapter", async () => {
    await readerAttached();
    const { doc, select } = makeChapterDocument();
    handler("rendered")(null, { document: doc });
    scrollTo(scroller, PAGE);
    handler("relocated")({ start: { cfi: "epubcfi(/6/4!/4)" }, atEnd: false });

    select("a passage");
    scrollTo(scroller, PAGE + 200);
    expect(scroller.scrollLeft).toBe(PAGE);
  });
});
