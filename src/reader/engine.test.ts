// Light engine tests: epub.js is mocked. We assert the two things the engine
// actually decides — spread logic (viewport width → "always" / "none") and the
// settings → `rendition.themes` mapping — plus the debounced relayout.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderContentSettings } from "./engine";

const { book, rendition, ePubFn } = vi.hoisted(() => {
  const themes = {
    font: vi.fn(),
    fontSize: vi.fn(),
    override: vi.fn(),
    default: vi.fn(),
  };
  const rendition = {
    themes,
    display: vi.fn(async () => {}),
    on: vi.fn((_type: string, _cb: (loc: unknown) => void) => {}),
    spread: vi.fn((_spread: string) => {}),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    destroy: vi.fn(),
    currentLocation: vi.fn(() => ({
      start: { cfi: "epubcfi(/6/2!/4)", displayed: { page: 1, total: 2 } },
    })),
  };
  const book = {
    ready: Promise.resolve(),
    loaded: { spine: Promise.resolve({ length: 12 }) },
    locations: {
      generate: vi.fn(async (): Promise<unknown[]> => []),
      percentageFromCfi: vi.fn(() => 0.5),
    },
    renderTo: vi.fn((_el: unknown, _opts: Record<string, unknown>) => rendition),
    destroy: vi.fn(),
  };
  const ePubFn = vi.fn((_data: unknown) => book);
  return { book, rendition, themes, ePubFn };
});

vi.mock("epubjs", () => ({ default: ePubFn }));

// The content pipeline (normalizer hook + fine-press stylesheet) has its own
// test — here it is a no-op handle so the engine's own decisions are isolated.
const pipelineRefresh = vi.fn();
vi.mock("./content-hook", () => ({
  registerContentPipeline: vi.fn(() =>
    Object.assign(() => {}, { refresh: pipelineRefresh, destroy: vi.fn() }),
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

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

beforeEach(() => {
  vi.clearAllMocks();
  setViewport(1280);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("spread logic", () => {
  it("uses a two-page spread at desktop width (>= 1024)", async () => {
    setViewport(1280);
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));

    expect(book.renderTo).toHaveBeenCalledTimes(1);
    const opts = book.renderTo.mock.calls[0][1];
    expect(opts).toMatchObject({
      manager: "default",
      flow: "paginated",
      width: "100%",
      height: "100%",
      spread: "always",
    });
  });

  it("uses a single page below 1024", async () => {
    setViewport(800);
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));

    expect(book.renderTo.mock.calls[0][1]).toMatchObject({ spread: "none" });
  });

  it("relayout() re-applies the spread for the new width, debounced ~150ms", async () => {
    vi.useFakeTimers();
    setViewport(1280);
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));

    setViewport(700);
    reader.relayout();
    reader.relayout(); // coalesced
    expect(rendition.spread).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(rendition.spread).toHaveBeenCalledTimes(1);
    expect(rendition.spread).toHaveBeenCalledWith("none");
  });
});

describe("applySettings", () => {
  it("refreshes the content pipeline (which owns all content CSS)", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));
    pipelineRefresh.mockClear();

    reader.applySettings({ ...BASE_SETTINGS, fontFamily: "legible" });
    expect(pipelineRefresh).toHaveBeenCalledTimes(1);
  });

  it("re-flows the current CFI so the change shows without a page turn", async () => {
    vi.useFakeTimers();
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));
    rendition.display.mockClear();

    reader.applySettings({ ...BASE_SETTINGS, fontSize: 1.3 });
    await vi.advanceTimersByTimeAsync(120);

    expect(rendition.display).toHaveBeenCalledWith("epubcfi(/6/2!/4)");
    vi.useRealTimers();
  });
});

describe("wiring", () => {
  it("opens from an ArrayBuffer, exposes sectionCount, subscribes to relocated", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    expect(ePubFn).toHaveBeenCalledTimes(1);
    expect(ePubFn.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer);
    expect(reader.sectionCount).toBe(12);

    await reader.attach(document.createElement("div"));
    expect(rendition.on).toHaveBeenCalledWith("relocated", expect.any(Function));
    expect(book.locations.generate).toHaveBeenCalledWith(1200);
  });

  it("percent stays 0 until locations.generate resolves, then reflects book.locations", async () => {
    let resolveGen: (v: unknown[]) => void = () => {};
    book.locations.generate.mockImplementationOnce(
      () => new Promise<unknown[]>((r) => (resolveGen = r)),
    );

    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    const seen: number[] = [];
    reader.onRelocated((loc) => seen.push(loc.percent));
    await reader.attach(document.createElement("div"));

    // Simulate a relocation before locations are ready.
    const relocatedCb = rendition.on.mock.calls.find(
      (c) => c[0] === "relocated",
    )![1] as (loc: unknown) => void;
    relocatedCb({ start: { cfi: "epubcfi(/6/4!/2)", displayed: { page: 2, total: 9 } } });
    expect(seen.at(-1)).toBe(0);

    resolveGen([]);
    await Promise.resolve();
    await Promise.resolve();

    relocatedCb({ start: { cfi: "epubcfi(/6/4!/2)", displayed: { page: 2, total: 9 } } });
    expect(seen.at(-1)).toBe(0.5); // book.locations.percentageFromCfi mock
  });
});
