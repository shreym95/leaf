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
    spine: { get: vi.fn((_target: string) => null as { href?: string } | null) },
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

  it("subscribes to the rendition's `selected` event and forwards real selections", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    const seen: { cfiRange: string; text: string }[] = [];
    reader.onSelected((s) => seen.push(s));
    await reader.attach(document.createElement("div"));

    const selectedCb = rendition.on.mock.calls.find(
      (c) => c[0] === "selected",
    )![1] as (cfi: unknown, contents: unknown) => void;

    const contents = {
      window: { getSelection: () => ({ toString: () => "  a passage  " }) },
    };
    selectedCb("epubcfi(/6/4!/2,/1:0,/1:9)", contents);
    selectedCb("epubcfi(/6/4!/2,/1:0,/1:9)", contents); // repeat — ignored
    selectedCb("epubcfi(/6/4!/2,/1:0,/1:0)", {
      window: { getSelection: () => ({ toString: () => "" }) },
    }); // empty — ignored

    expect(seen).toEqual([
      { cfiRange: "epubcfi(/6/4!/2,/1:0,/1:9)", text: "a passage" },
    ]);
  });

  it("addHighlight / removeHighlight drive rendition.annotations with the CFI range", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));

    reader.addHighlight("epubcfi(/6/8!/4,/1:2,/1:40)", {
      id: "h1",
      styles: { fill: "var(--x)" },
    });
    expect(rendition.annotations.add).toHaveBeenCalledWith(
      "highlight",
      "epubcfi(/6/8!/4,/1:2,/1:40)",
      { id: "h1" },
      undefined,
      expect.stringContaining("leaf-hl-h1"),
      { fill: "var(--x)" },
    );

    reader.removeHighlight("epubcfi(/6/8!/4,/1:2,/1:40)");
    expect(rendition.annotations.remove).toHaveBeenCalledWith(
      "epubcfi(/6/8!/4,/1:2,/1:40)",
      "highlight",
    );
  });

  it("currentChapterLabel() resolves the current section's title from the EPUB TOC", async () => {
    book.navigation.toc = [
      { href: "text/part0001.html", label: "Chapter 1" },
      {
        href: "text/part0003.html#top",
        label: "  Chapter 3  ",
        subitems: [{ href: "text/part0004.html", label: "Chapter 3.1" }],
      },
    ];
    try {
      const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
      await reader.attach(document.createElement("div"));
      // currentLocation() (mock) reports href "text/part0003.html"; the TOC
      // entry carries a fragment and padding — both are normalised away.
      expect(reader.currentChapterLabel()).toBe("Chapter 3");
    } finally {
      book.navigation.toc = [];
    }
  });

  it("currentChapterLabel() is undefined when the TOC has no matching entry", async () => {
    book.navigation.toc = [{ href: "text/part0099.html", label: "Elsewhere" }];
    try {
      const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
      await reader.attach(document.createElement("div"));
      expect(reader.currentChapterLabel()).toBeUndefined();
    } finally {
      book.navigation.toc = [];
    }
  });

  it("chapterLabelForCfi() resolves an ARBITRARY CFI's chapter without navigating", async () => {
    book.navigation.toc = [
      { href: "text/part0007.html", label: "Chapter 7" },
    ];
    book.spine.get.mockReturnValue({ href: "text/part0007.html" });
    try {
      const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
      await reader.attach(document.createElement("div"));

      expect(reader.chapterLabelForCfi("epubcfi(/6/14!/4/2/1:0)")).toBe(
        "Chapter 7",
      );
      // No navigation happened — this is a pure lookup.
      expect(rendition.display).not.toHaveBeenCalledWith(
        "epubcfi(/6/14!/4/2/1:0)",
      );
    } finally {
      book.navigation.toc = [];
      book.spine.get.mockReturnValue(null);
    }
  });

  it("chapterLabelForCfi() is undefined when the spine has nothing for that CFI", async () => {
    book.spine.get.mockReturnValue(null);
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));
    expect(reader.chapterLabelForCfi("epubcfi(/6/999!/4)")).toBeUndefined();
  });

  it("toc() flattens the EPUB navigation depth-first, trimming labels", async () => {
    book.navigation.toc = [
      { href: "text/cover.html", label: "  Cover  " },
      {
        href: "text/part0001.html#top",
        label: "Chapter 1",
        subitems: [
          { href: "text/part0001.html#s2", label: "  Section 1.2  " },
          { href: "", label: "no href — skipped" },
          { href: "text/part0001.html#s3", label: "" },
        ],
      },
      { href: "text/part0002.html", label: "Chapter 2" },
    ];
    try {
      const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
      await reader.attach(document.createElement("div"));
      expect(reader.toc()).toEqual([
        { href: "text/cover.html", label: "Cover" },
        { href: "text/part0001.html#top", label: "Chapter 1" },
        { href: "text/part0001.html#s2", label: "Section 1.2" },
        { href: "text/part0002.html", label: "Chapter 2" },
      ]);
    } finally {
      book.navigation.toc = [];
    }
  });

  it("toc() is an empty array when the EPUB has no navigation", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));
    expect(reader.toc()).toEqual([]);
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

// --- Relocation cause + atEnd (finished-book detection) ---------------------
//
// epub.js emits `relocated` in a requestAnimationFrame AFTER the promise from
// next()/prev()/display() has settled, so a relocation can only be attributed
// to a navigation once that navigation's promise has resolved. jsdom cannot
// model real pagination — these tests drive the mocked rendition's promises and
// `relocated` callback by hand to pin the engine's attribution rule, not
// epub.js's timing.
describe("relocation cause and atEnd", () => {
  function deferred() {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function setup() {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    const seen: { cause?: string; atEnd?: boolean; cfi: string }[] = [];
    reader.onRelocated((loc) =>
      seen.push({ cause: loc.cause, atEnd: loc.atEnd, cfi: loc.cfi }),
    );
    await reader.attach(document.createElement("div"));
    await Promise.resolve();
    seen.length = 0; // drop anything attach itself produced
    const relocated = rendition.on.mock.calls.find(
      (c) => c[0] === "relocated",
    )![1] as (loc: unknown) => void;
    const fire = (extra: Record<string, unknown> = {}, cfi = "epubcfi(/6/4!/2)") =>
      relocated({
        start: { cfi, displayed: { page: 2, total: 9 } },
        ...extra,
      });
    return { reader, seen, fire };
  }

  it("tags a relocation that arrives after next() resolved as 'next'", async () => {
    const { reader, seen, fire } = await setup();
    await reader.next();
    fire();
    expect(seen.map((s) => s.cause)).toEqual(["next"]);
  });

  it("tags prev() and goTo() the same way", async () => {
    const { reader, seen, fire } = await setup();
    await reader.prev();
    fire();
    await reader.goTo("epubcfi(/6/8!/4)");
    fire();
    expect(seen.map((s) => s.cause)).toEqual(["prev", "jump"]);
  });

  it("tags a relocation that arrives BEFORE the nav promise resolved as 'other'", async () => {
    const { reader, seen, fire } = await setup();
    const gate = deferred();
    rendition.next.mockImplementationOnce(() => gate.promise);

    const turn = reader.next();
    fire(); // lands before the turn's promise has settled
    gate.resolve();
    await turn;
    fire(); // the real post-settle relocation

    expect(seen.map((s) => s.cause)).toEqual(["other", "next"]);
  });

  it("tags the scroll-debounce duplicate that follows a turn as 'other'", async () => {
    const { reader, seen, fire } = await setup();
    await reader.next();
    fire(); // the turn's relocation
    fire(); // the 20ms scroll-debounce duplicate from a programmatic scroll
    fire();
    expect(seen.map((s) => s.cause)).toEqual(["next", "other", "other"]);
  });

  it("tags a relocation with no navigation behind it as 'other'", async () => {
    const { seen, fire } = await setup();
    fire(); // e.g. a resize re-flow
    expect(seen.map((s) => s.cause)).toEqual(["other"]);
  });

  it("settles prev() as soon as epub.js resolves, before the snap-back frame", async () => {
    const { reader, seen, fire } = await setup();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    try {
      void reader.prev(); // parks on the (never-run) snap-back frame
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      fire(); // epub.js's relocation, while the engine's own frame is pending
      expect(seen.map((s) => s.cause)).toEqual(["prev"]);
    } finally {
      raf.mockRestore();
    }
  });

  it("an older navigation settling late does not settle a newer one still in flight", async () => {
    const { reader, seen, fire } = await setup();
    const slowJump = deferred();
    const turnGate = deferred();
    rendition.display.mockImplementationOnce(() => slowJump.promise);
    rendition.next.mockImplementationOnce(() => turnGate.promise);

    const jump = reader.goTo("epubcfi(/6/8!/4)"); // in flight...
    const turn = reader.next(); // ...superseded by a turn, also in flight
    slowJump.resolve(); // the OLD jump settles first
    await jump;
    fire(); // relocation lands while the turn has not settled
    turnGate.resolve();
    await turn;
    fire();

    expect(seen.map((s) => s.cause)).toEqual(["other", "next"]);
  });

  it("does not tag a later relocation with the cause of a navigation that failed", async () => {
    const { reader, seen, fire } = await setup();
    rendition.display.mockImplementationOnce(async () => {
      throw new Error("bad target");
    });
    await expect(reader.goTo("nope")).rejects.toThrow("bad target");
    fire();
    expect(seen.map((s) => s.cause)).toEqual(["other"]);
  });

  it("the locations-ready relocation is 'other' and leaves a settled turn pending", async () => {
    let resolveGen: (v: unknown[]) => void = () => {};
    book.locations.generate.mockImplementationOnce(
      () => new Promise<unknown[]>((r) => (resolveGen = r)),
    );
    const { reader, seen, fire } = await setup();

    await reader.next(); // settled, its relocation not yet delivered
    resolveGen([]);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The synthetic relocation fired (from currentLocation()) as 'other'...
    expect(seen.map((s) => s.cause)).toEqual(["other"]);
    // ...and did not consume the turn's pending cause.
    fire();
    expect(seen.map((s) => s.cause)).toEqual(["other", "next"]);
  });

  it("passes atEnd through from epub.js, and is false when it is absent", async () => {
    const { reader, seen, fire } = await setup();
    await reader.next();
    fire({ atEnd: true });
    await reader.next();
    fire();
    expect(seen.map((s) => s.atEnd)).toEqual([true, false]);
  });
});
