// Regression: epub.js hands the annotation class name to marks-pane, which calls
// `classList.add(className)`. A name with whitespace throws there; the engine
// swallows the error, so the highlight was never painted. Same epub.js mock as
// engine.test.ts.

import { describe, expect, it, vi } from "vitest";
import type { ReaderContentSettings } from "./engine";

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

describe("addHighlight class name", () => {
  it("is one class token that classList.add accepts", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));

    reader.addHighlight("epubcfi(/6/8!/4,/1:2,/1:40)", { id: "h1", styles: {} });

    const className = rendition.annotations.add.mock.calls[0]?.[4] as string;
    expect(className).toMatch(/^\S+$/);
    expect(() => document.createElement("div").classList.add(className)).not.toThrow();
  });
});
