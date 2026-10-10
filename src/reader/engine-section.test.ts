// Section position on relocation: `spineIndex`, `spineHref` and
// `sectionFraction` are additive fields built from epub.js's per-section
// `located.start` data. epub.js is mocked, as in engine.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderContentSettings, ReaderLocation } from "./engine";

const { rendition, ePubFn } = vi.hoisted(() => {
  const rendition = {
    themes: {
      font: vi.fn(),
      fontSize: vi.fn(),
      override: vi.fn(),
      default: vi.fn(),
    },
    display: vi.fn(async () => {}),
    on: vi.fn((_type: string, _cb: (loc: unknown) => void) => {}),
    spread: vi.fn((_spread: string) => {}),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    annotations: { add: vi.fn(), remove: vi.fn() },
    getContents: vi.fn(() => [] as unknown[]),
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
    navigation: { toc: [] as unknown[] },
    spine: { get: vi.fn((_target: string) => null as { href?: string } | null) },
    renderTo: vi.fn((_el: unknown, _opts: Record<string, unknown>) => rendition),
    destroy: vi.fn(),
  };
  const ePubFn = vi.fn((_data: unknown) => book);
  return { rendition, ePubFn };
});

vi.mock("epubjs", () => ({ default: ePubFn }));

vi.mock("./content-hook", () => ({
  registerContentPipeline: vi.fn(() =>
    Object.assign(() => {}, { refresh: vi.fn(), destroy: vi.fn() }),
  ),
}));

import { createReader, sectionFractionOf } from "./engine";

const BASE_SETTINGS: ReaderContentSettings = {
  fontFamily: "serif",
  fontSize: 1.06,
  lineSpacing: 1.62,
  margins: "normal",
  theme: "day",
};

async function setup() {
  const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
  const seen: ReaderLocation[] = [];
  reader.onRelocated((loc) => seen.push(loc));
  await reader.attach(document.createElement("div"));
  await Promise.resolve();
  seen.length = 0; // drop anything attach itself produced
  const relocated = rendition.on.mock.calls.find(
    (c) => c[0] === "relocated",
  )![1] as (loc: unknown) => void;
  const fire = (start: Record<string, unknown>) =>
    relocated({ start: { cfi: "epubcfi(/6/4!/2)", ...start } });
  return { seen, fire };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("section position on relocation", () => {
  it("reports the first page of a section as fraction 0", async () => {
    const { seen, fire } = await setup();
    fire({ index: 3, href: "text/ch3.xhtml", displayed: { page: 1, total: 9 } });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      spineIndex: 3,
      spineHref: "text/ch3.xhtml",
      sectionFraction: 0,
    });
  });

  it("reports a middle page proportionally", async () => {
    const { seen, fire } = await setup();
    fire({ index: 3, href: "text/ch3.xhtml", displayed: { page: 5, total: 9 } });
    expect(seen[0].sectionFraction).toBe(0.5);
    fire({ index: 3, href: "text/ch3.xhtml", displayed: { page: 2, total: 5 } });
    expect(seen[1].sectionFraction).toBe(0.25);
  });

  it("reports the last page of a section as fraction 1", async () => {
    const { seen, fire } = await setup();
    fire({ index: 3, href: "text/ch3.xhtml", displayed: { page: 9, total: 9 } });
    expect(seen[0].sectionFraction).toBe(1);
  });

  it("reports a single-page section as fraction 0", async () => {
    const { seen, fire } = await setup();
    fire({ index: 0, href: "text/cover.xhtml", displayed: { page: 1, total: 1 } });
    expect(seen[0].sectionFraction).toBe(0);
  });

  it("clamps an out-of-range page into [0, 1]", async () => {
    const { seen, fire } = await setup();
    fire({ index: 1, href: "a.xhtml", displayed: { page: 12, total: 9 } });
    fire({ index: 1, href: "a.xhtml", displayed: { page: 0, total: 9 } });
    expect(seen.map((s) => s.sectionFraction)).toEqual([1, 0]);
  });

  it("strips a #fragment from the href", async () => {
    const { seen, fire } = await setup();
    fire({
      index: 4,
      href: "text/ch4.xhtml#section-2",
      displayed: { page: 1, total: 3 },
    });
    expect(seen[0].spineHref).toBe("text/ch4.xhtml");
  });

  it("leaves every field undefined when epub.js gives no section data", async () => {
    const { seen, fire } = await setup();
    fire({});
    expect(seen).toHaveLength(1);
    expect(seen[0].spineIndex).toBeUndefined();
    expect(seen[0].spineHref).toBeUndefined();
    expect(seen[0].sectionFraction).toBeUndefined();
  });

  it("leaves sectionFraction undefined when only one page count is known", async () => {
    const { seen, fire } = await setup();
    fire({ index: 2, href: "a.xhtml", displayed: { page: 3 } });
    fire({ index: 2, href: "a.xhtml", displayed: { total: 3 } });
    expect(seen.map((s) => s.sectionFraction)).toEqual([undefined, undefined]);
    expect(seen.map((s) => s.spineIndex)).toEqual([2, 2]);
  });

  it("does not change the existing fields for the same input", async () => {
    const { seen, fire } = await setup();
    fire({ index: 3, href: "text/ch3.xhtml", displayed: { page: 5, total: 9 } });
    expect(seen[0]).toEqual({
      cfi: "epubcfi(/6/4!/2)",
      percent: 0.5,
      estimated: false,
      displayedPage: 5,
      totalPages: 9,
      spineIndex: 3,
      spineHref: "text/ch3.xhtml",
      sectionFraction: 0.5,
      atEnd: false,
      cause: "other",
    });
  });
});

describe("sectionFractionOf", () => {
  it("maps first/last/single page and rejects missing or non-finite input", () => {
    expect(sectionFractionOf(1, 10)).toBe(0);
    expect(sectionFractionOf(10, 10)).toBe(1);
    expect(sectionFractionOf(1, 1)).toBe(0);
    expect(sectionFractionOf(1, 0)).toBe(0);
    expect(sectionFractionOf(undefined, 10)).toBeUndefined();
    expect(sectionFractionOf(2, undefined)).toBeUndefined();
    expect(sectionFractionOf(Number.NaN, 10)).toBeUndefined();
    expect(sectionFractionOf(2, Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
