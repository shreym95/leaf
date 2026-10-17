// Selection and content-tap plumbing of the reader engine. epub.js is mocked
// (same pattern as engine.test.ts); the iframe document and window are plain
// DOM objects, so the selectionchange / pointerdown watchers run for real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderContentSettings, ReaderController } from "./engine";

const { rendition, ePubFn } = vi.hoisted(() => {
  const themes = {
    font: vi.fn(),
    fontSize: vi.fn(),
    override: vi.fn(),
    default: vi.fn(),
  };
  const rendition = {
    themes,
    display: vi.fn(async () => {}),
    on: vi.fn((_type: string, _cb: (...args: unknown[]) => void) => {}),
    spread: vi.fn((_spread: string) => {}),
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

type FakeSelection = { rangeCount: number; isCollapsed: boolean; text: string };

// A book iframe: a real document (so its listeners are real) whose window
// reports a selection the test controls.
function makeIframe() {
  const doc = document.implementation.createHTMLDocument("book");
  const sel: FakeSelection = { rangeCount: 0, isCollapsed: true, text: "" };
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
  } as unknown as Window & { frameElement?: unknown };
  Object.defineProperty(doc, "defaultView", { value: win });
  const frameEl = { getBoundingClientRect: () => RECT(0, 1000) };
  Object.defineProperty(win, "frameElement", { value: frameEl });
  const select = (text: string) => {
    sel.rangeCount = 1;
    sel.isCollapsed = false;
    sel.text = text;
  };
  const collapse = () => {
    sel.rangeCount = 1;
    sel.isCollapsed = true;
    sel.text = "";
  };
  return { doc, win, frameEl, select, collapse };
}

function handler(name: string): (...args: unknown[]) => void {
  const call = rendition.on.mock.calls.find((c) => c[0] === name);
  if (!call) throw new Error(`no rendition.on("${name}") registered`);
  return call[1] as (...args: unknown[]) => void;
}

function renderedWith(view: unknown) {
  for (const c of rendition.on.mock.calls) {
    if (c[0] === "rendered") (c[1] as (...a: unknown[]) => void)(null, view);
  }
}

async function readerAttached(): Promise<{
  reader: ReaderController;
  container: HTMLElement;
}> {
  const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
  const container = document.createElement("div");
  container.getBoundingClientRect = () => RECT(0, 1000);
  await reader.attach(container);
  return { reader, container };
}

let readers: ReaderController[] = [];

async function open() {
  const made = await readerAttached();
  readers.push(made.reader);
  return made;
}

beforeEach(() => {
  vi.clearAllMocks();
  readers = [];
});

afterEach(() => {
  for (const r of readers) r.destroy();
});

describe("onSelection — settled selection", () => {
  it("fires once per distinct cfi with the trimmed text", async () => {
    const { reader } = await open();
    const seen: { cfiRange: string; text: string }[] = [];
    reader.onSelection((s) => seen.push(s));

    const selected = handler("selected");
    const contents = {
      window: { getSelection: () => ({ toString: () => "  a passage  " }) },
    };
    selected("epubcfi(/6/4!/2,/1:0,/1:9)", contents);
    selected("epubcfi(/6/4!/2,/1:0,/1:9)", contents); // same cfi — deduped
    selected("epubcfi(/6/4!/2,/1:10,/1:19)", {
      window: { getSelection: () => ({ toString: () => "another" }) },
    }); // distinct cfi — fires

    expect(seen).toEqual([
      { cfiRange: "epubcfi(/6/4!/2,/1:0,/1:9)", text: "a passage" },
      { cfiRange: "epubcfi(/6/4!/2,/1:10,/1:19)", text: "another" },
    ]);
  });

  it("ignores a settled selection with no text", async () => {
    const { reader } = await open();
    const spy = vi.fn();
    reader.onSelection(spy);

    handler("selected")("epubcfi(/6/4!/2,/1:0,/1:0)", {
      window: { getSelection: () => ({ toString: () => "   " }) },
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("re-selecting the same range after a collapse fires again", async () => {
    const { reader } = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    reader.onSelection(spy);
    const cfi = "epubcfi(/6/4!/2,/1:0,/1:9)";
    const contents = { window: iframe.win };

    iframe.select("a passage");
    iframe.doc.dispatchEvent(new Event("selectionchange"));
    handler("selected")(cfi, contents);
    iframe.collapse();
    iframe.doc.dispatchEvent(new Event("selectionchange"));
    iframe.select("a passage");
    handler("selected")(cfi, contents);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("keeps onSelected working for existing callers", async () => {
    const { reader } = await open();
    const spy = vi.fn();
    reader.onSelected(spy);

    handler("selected")("epubcfi(/6/4!/2,/1:0,/1:9)", {
      window: { getSelection: () => ({ toString: () => "text" }) },
    });

    expect(spy).toHaveBeenCalledWith({
      cfiRange: "epubcfi(/6/4!/2,/1:0,/1:9)",
      text: "text",
    });
  });

  it("unsubscribe stops delivery", async () => {
    const { reader } = await open();
    const spy = vi.fn();
    const off = reader.onSelection(spy);
    off();

    handler("selected")("epubcfi(/6/4!/2,/1:0,/1:9)", {
      window: { getSelection: () => ({ toString: () => "text" }) },
    });

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("onSelectionCleared — collapse of the iframe selection", () => {
  it("fires once when a selection that held text collapses", async () => {
    const { reader } = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    reader.onSelectionCleared(spy);

    iframe.doc.dispatchEvent(new Event("selectionchange")); // nothing selected yet
    expect(spy).not.toHaveBeenCalled();

    iframe.select("a passage");
    iframe.doc.dispatchEvent(new Event("selectionchange"));
    iframe.collapse();
    iframe.doc.dispatchEvent(new Event("selectionchange"));
    iframe.doc.dispatchEvent(new Event("selectionchange")); // still collapsed

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("is reported for clearSelection() as well", async () => {
    const { reader } = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    reader.onSelectionCleared(spy);
    rendition.getContents.mockReturnValue([{ window: iframe.win }] as never);

    iframe.select("a passage");
    iframe.doc.dispatchEvent(new Event("selectionchange"));
    reader.clearSelection();
    iframe.doc.dispatchEvent(new Event("selectionchange")); // browsers fire this async

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a throwing subscriber does not stop the others", async () => {
    const { reader } = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const good = vi.fn();
    reader.onSelectionCleared(() => {
      throw new Error("bad subscriber");
    });
    reader.onSelectionCleared(good);

    iframe.select("a passage");
    iframe.doc.dispatchEvent(new Event("selectionchange"));
    iframe.collapse();
    iframe.doc.dispatchEvent(new Event("selectionchange"));

    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe("onContentTap — taps inside the book frame", () => {
  function tapEvent(
    iframe: ReturnType<typeof makeIframe>,
    init: {
      clientX: number;
      detail?: number;
      target?: Element;
      clientY?: number;
    },
  ) {
    return {
      clientX: init.clientX,
      clientY: init.clientY ?? 300,
      detail: init.detail ?? 1,
      target: init.target ?? document.createElement("p"),
      view: iframe.win,
    };
  }

  it("maps a tap at 20% and at 80% of the frame to xFraction 0.2 and 0.8", async () => {
    const { reader } = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    reader.onContentTap(spy);
    const click = handler("click");

    click(tapEvent(iframe, { clientX: 200 }));
    click(tapEvent(iframe, { clientX: 800 }));

    expect(spy.mock.calls[0][0].xFraction).toBeCloseTo(0.2);
    expect(spy.mock.calls[1][0].xFraction).toBeCloseTo(0.8);
    expect(spy.mock.calls[0][0].selectionActive).toBe(false);
  });

  it("reports selectionActive when the iframe still holds a selection", async () => {
    const { reader } = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    reader.onContentTap(spy);

    iframe.select("a passage");
    handler("click")(tapEvent(iframe, { clientX: 500 }));

    expect(spy).toHaveBeenCalledWith({ xFraction: 0.5, selectionActive: true });
  });

  it("ignores a keyboard-activated click (detail 0)", async () => {
    const { reader } = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    reader.onContentTap(spy);

    handler("click")(tapEvent(iframe, { clientX: 200, detail: 0 }));

    expect(spy).not.toHaveBeenCalled();
  });

  it("ignores a click on a link", async () => {
    const { reader } = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    reader.onContentTap(spy);

    const link = document.createElement("a");
    link.setAttribute("href", "#chapter-2");
    const inner = document.createElement("span");
    link.appendChild(inner);
    handler("click")(tapEvent(iframe, { clientX: 200, target: inner }));

    expect(spy).not.toHaveBeenCalled();
  });

  it("ignores the click that ends a drag-selection", async () => {
    const { reader } = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    reader.onContentTap(spy);

    iframe.doc.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 100, clientY: 300 }),
    );
    iframe.select("a passage");
    handler("click")(tapEvent(iframe, { clientX: 400, clientY: 300 }));

    expect(spy).not.toHaveBeenCalled();
  });

  it("still treats a jittery tap (within the drag slop) as a tap", async () => {
    const { reader } = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    reader.onContentTap(spy);

    iframe.doc.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 100, clientY: 300 }),
    );
    handler("click")(tapEvent(iframe, { clientX: 103, clientY: 302 }));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops delivery", async () => {
    const { reader } = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    const off = reader.onContentTap(spy);
    off();

    handler("click")(tapEvent(iframe, { clientX: 200 }));

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("destroy — teardown", () => {
  it("detaches the iframe watchers and clears every subscriber", async () => {
    const { reader } = await open();
    const iframe = makeIframe();
    const removeSpy = vi.spyOn(iframe.doc, "removeEventListener");
    renderedWith({ document: iframe.doc });
    const cleared = vi.fn();
    const tap = vi.fn();
    reader.onSelectionCleared(cleared);
    reader.onContentTap(tap);

    reader.destroy();

    expect(removeSpy).toHaveBeenCalledWith(
      "selectionchange",
      expect.any(Function),
    );
    expect(removeSpy).toHaveBeenCalledWith("pointerdown", expect.any(Function));

    iframe.select("a passage");
    iframe.doc.dispatchEvent(new Event("selectionchange"));
    iframe.collapse();
    iframe.doc.dispatchEvent(new Event("selectionchange"));
    handler("click")({
      clientX: 200,
      detail: 1,
      target: document.createElement("p"),
      view: iframe.win,
    });

    expect(cleared).not.toHaveBeenCalled();
    expect(tap).not.toHaveBeenCalled();
  });
});
