// locateCfi(): any CFI (point or range) → spine section + in-section fraction.
// A rendered section is measured from its pagination (exact: true). An
// unrendered one falls back to fraction 1 (exact: false) so a group member is
// never shown an item before finishing that chapter. Same epub.js mock as
// engine.highlight-rerender.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderContentSettings } from "./engine";

const { rendition, ePubFn, book } = vi.hoisted(() => {
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
    manager: {
      layout: {
        pageWidth: 500,
        count: vi.fn((_len: number) => ({ pages: 6 })),
      },
    },
  };
  // Spine position of a CFI: `/6/N!` is spine item (N/2 - 1), as epub.js reads it.
  const book = {
    ready: Promise.resolve(),
    loaded: { spine: Promise.resolve({ length: 12 }) },
    locations: {
      generate: vi.fn(async (): Promise<unknown[]> => []),
      percentageFromCfi: vi.fn(() => 0.5),
    },
    navigation: { toc: [] as unknown[] },
    spine: {
      get: vi.fn((cfi: string) => {
        const m = /^epubcfi\(\/6\/(\d+)!/.exec(cfi);
        if (!m) return null;
        const index = Number(m[1]) / 2 - 1;
        return { index, href: `text/part000${index}.html#frag` };
      }),
    },
    renderTo: vi.fn((_el: unknown, _opts: Record<string, unknown>) => rendition),
    destroy: vi.fn(),
  };
  const ePubFn = vi.fn((_data: unknown) => book);
  return { book, rendition, ePubFn };
});

vi.mock("epubjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("epubjs")>()),
  default: ePubFn,
}));

// The content pipeline has its own test; here it is a no-op handle.
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

// Spine item 3 (`/6/8!`).
const POINT_IN_SECTION_3 = "epubcfi(/6/8!/4/1:10)";
const RANGE_IN_SECTION_3 = "epubcfi(/6/8!/4,/1:2,/1:40)";

// A live Contents for spine item `sectionIndex`. `left` is where the point sits
// inside the section (px); `locationOf` records the CFI it was asked about.
function contentsFor(sectionIndex: number, left: number, asked: string[]) {
  return {
    sectionIndex,
    locationOf: vi.fn((target: string) => {
      asked.push(target);
      return { left, top: 0 };
    }),
    textWidth: vi.fn(() => 3000),
  };
}

describe("locateCfi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rendition.getContents.mockReturnValue([]);
    rendition.manager.layout.pageWidth = 500;
    rendition.manager.layout.count.mockReturnValue({ pages: 6 });
  });

  it("measures the fraction of a rendered section from its pagination (exact: true)", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));
    const asked: string[] = [];
    // left 1000 / pageWidth 500 → column 2 → page 3 of 6 → (3-1)/(6-1) = 0.4.
    rendition.getContents.mockReturnValue([contentsFor(3, 1000, asked)]);

    const located = reader.locateCfi(POINT_IN_SECTION_3);

    expect(located).toEqual({
      spineIndex: 3,
      spineHref: "text/part0003.html",
      sectionFraction: 0.4,
      exact: true,
    });
    expect(asked).toEqual([POINT_IN_SECTION_3]);
  });

  it("returns fraction 1 and exact: false for a section that is not rendered", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));
    // Only spine item 6 is rendered; the point is in item 3.
    rendition.getContents.mockReturnValue([contentsFor(6, 0, [])]);

    expect(reader.locateCfi(POINT_IN_SECTION_3)).toEqual({
      spineIndex: 3,
      spineHref: "text/part0003.html",
      sectionFraction: 1,
      exact: false,
    });
  });

  it("uses the start of a range CFI for the section and the measure", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));
    const asked: string[] = [];
    rendition.getContents.mockReturnValue([contentsFor(3, 1000, asked)]);

    const located = reader.locateCfi(RANGE_IN_SECTION_3);

    expect(located?.spineIndex).toBe(3);
    expect(located?.sectionFraction).toBe(0.4);
    expect(located?.exact).toBe(true);
    // The measure is taken at the range's start point, not the whole range.
    expect(asked).toHaveLength(1);
    expect(asked[0]).not.toContain(",");
    expect(asked[0]).toContain("/1:2");
    expect(asked[0]).not.toContain("/1:40");
  });

  it("returns null for a CFI the spine cannot resolve", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));

    expect(reader.locateCfi("not-a-cfi")).toBeNull();
  });

  it("returns null, never throws, when the spine throws", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));
    book.spine.get.mockImplementationOnce(() => {
      throw new Error("spine broke");
    });

    let result: unknown;
    expect(() => {
      result = reader.locateCfi(POINT_IN_SECTION_3);
    }).not.toThrow();
    expect(result).toBeNull();
  });
});
