// A tap reported by the engine is marked as handled inside the book iframe, so
// Chrome for Android's Touch to Search does not select the word under the tap.
// epub.js is mocked (same pattern as engine.selection.test.ts); the iframe
// document and window are plain DOM objects, and the click is a real
// cancelable MouseEvent so `defaultPrevented` reflects what the engine did.

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

// A book iframe: a real document plus a window whose frameElement is the
// iframe element the engine maps taps onto.
function makeIframe() {
  const doc = document.implementation.createHTMLDocument("book");
  const win = {
    getSelection: () => ({
      rangeCount: 0,
      isCollapsed: true,
      toString: () => "",
      removeAllRanges: () => {},
    }),
  } as unknown as Window & { frameElement?: unknown; document?: Document };
  Object.defineProperty(doc, "defaultView", { value: win });
  Object.defineProperty(win, "document", { value: doc });
  const frameEl = { getBoundingClientRect: () => RECT(0, 1000) };
  Object.defineProperty(win, "frameElement", { value: frameEl });
  return { doc, win };
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

async function open() {
  const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
  const container = document.createElement("div");
  container.getBoundingClientRect = () => RECT(0, 1000);
  await reader.attach(container);
  readers.push(reader);
  return reader;
}

// A real, cancelable click as the browser delivers it: `view` and `target`
// point at the book iframe, as epub.js forwards them.
function clickIn(
  iframe: ReturnType<typeof makeIframe>,
  init: { clientX: number; clientY?: number; detail?: number; target?: Element },
): MouseEvent {
  const ev = new MouseEvent("click", {
    cancelable: true,
    bubbles: true,
    clientX: init.clientX,
    clientY: init.clientY ?? 300,
    detail: init.detail ?? 1,
  });
  Object.defineProperty(ev, "view", { value: iframe.win });
  Object.defineProperty(ev, "target", {
    value: init.target ?? iframe.doc.createElement("p"),
  });
  return ev;
}

let readers: ReaderController[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  readers = [];
});

afterEach(() => {
  for (const r of readers) r.destroy();
});

describe("handled tap — Touch to Search suppression", () => {
  it("prevents the default and changes the tapped document on a reported tap", async () => {
    const reader = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    reader.onContentTap(spy);

    const ev = clickIn(iframe, { clientX: 500 });
    handler("click")(ev);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    expect(iframe.doc.documentElement.getAttribute("data-leaf-tap")).toBe("1");
  });

  it("advances the mark on each reported tap so every tap changes the document", async () => {
    const reader = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    reader.onContentTap(vi.fn());

    handler("click")(clickIn(iframe, { clientX: 200 }));
    handler("click")(clickIn(iframe, { clientX: 800 }));

    expect(iframe.doc.documentElement.getAttribute("data-leaf-tap")).toBe("2");
  });

  it("leaves a click on a link alone", async () => {
    const reader = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    reader.onContentTap(spy);

    const link = iframe.doc.createElement("a");
    link.setAttribute("href", "#chapter-2");
    const inner = iframe.doc.createElement("span");
    link.appendChild(inner);
    const ev = clickIn(iframe, { clientX: 200, target: inner });
    handler("click")(ev);

    expect(spy).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    expect(iframe.doc.documentElement.hasAttribute("data-leaf-tap")).toBe(false);
  });

  it("leaves a keyboard-activated click (detail 0) alone", async () => {
    const reader = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    reader.onContentTap(spy);

    const ev = clickIn(iframe, { clientX: 200, detail: 0 });
    handler("click")(ev);

    expect(spy).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    expect(iframe.doc.documentElement.hasAttribute("data-leaf-tap")).toBe(false);
  });

  it("leaves the click that ends a drag-selection alone", async () => {
    const reader = await open();
    const iframe = makeIframe();
    renderedWith({ document: iframe.doc });
    const spy = vi.fn();
    reader.onContentTap(spy);

    iframe.doc.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 100, clientY: 300 }),
    );
    const ev = clickIn(iframe, { clientX: 400, clientY: 300 });
    handler("click")(ev);

    expect(spy).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    expect(iframe.doc.documentElement.hasAttribute("data-leaf-tap")).toBe(false);
  });
});
