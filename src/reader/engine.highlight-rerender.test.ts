// Regression: a highlight vanished after its chapter view was re-created (cross-
// chapter back, goTo, relayout). epub.js builds the mark at `hooks.render`,
// before Leaf's content pipeline normalizes the DOM, so the Range came out
// collapsed. The engine must re-paint registered highlights on `rendered`, which
// fires after `hooks.content`. Same epub.js mock as engine.highlight-class.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
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
        return m ? { index: Number(m[1]) / 2 - 1 } : null;
      }),
    },
    renderTo: vi.fn((_el: unknown, _opts: Record<string, unknown>) => rendition),
    destroy: vi.fn(),
  };
  const ePubFn = vi.fn((_data: unknown) => book);
  return { book, rendition, ePubFn };
});

vi.mock("epubjs", () => ({ default: ePubFn }));

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
const CFI_SECTION_3 = "epubcfi(/6/8!/4,/1:2,/1:40)";

// Fires every `rendered` listener the engine registered, as epub.js does after
// `hooks.content`. `section` carries the spine index the view was built for.
function fireRendered(section: { index: number }): void {
  for (const call of rendition.on.mock.calls) {
    if (call[0] === "rendered") {
      (call[1] as (s: unknown, v: unknown) => void)(section, { index: section.index });
    }
  }
}

describe("highlight re-paint after a chapter re-renders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-adds a section's highlight on its rendered event, with the same args", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));
    reader.addHighlight(CFI_SECTION_3, {
      id: "h1",
      styles: { fill: "red" },
      onClick: () => {},
    });
    rendition.annotations.add.mockClear();
    rendition.annotations.remove.mockClear();

    fireRendered({ index: 3 });

    expect(rendition.annotations.remove).toHaveBeenCalledTimes(1);
    expect(rendition.annotations.remove).toHaveBeenCalledWith(CFI_SECTION_3, "highlight");
    expect(rendition.annotations.add).toHaveBeenCalledTimes(1);
    const [type, cfi, data, cb, className, styles] =
      rendition.annotations.add.mock.calls[0] ?? [];
    expect(type).toBe("highlight");
    expect(cfi).toBe(CFI_SECTION_3);
    expect(data).toEqual({ id: "h1" });
    expect(typeof cb).toBe("function");
    expect(className).toBe("leaf-hl-h1");
    expect(styles).toEqual({ fill: "red" });
    // remove must run before add so epub.js does not keep a stale mark.
    expect(rendition.annotations.remove.mock.invocationCallOrder[0]).toBeLessThan(
      rendition.annotations.add.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("does nothing when a different section renders", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));
    reader.addHighlight(CFI_SECTION_3, { id: "h1", styles: {} });
    rendition.annotations.add.mockClear();
    rendition.annotations.remove.mockClear();

    fireRendered({ index: 6 });

    expect(rendition.annotations.add).not.toHaveBeenCalled();
    expect(rendition.annotations.remove).not.toHaveBeenCalled();
  });

  it("re-adds nothing after removeHighlight", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));
    reader.addHighlight(CFI_SECTION_3, { id: "h1", styles: {} });
    reader.removeHighlight(CFI_SECTION_3);
    rendition.annotations.add.mockClear();
    rendition.annotations.remove.mockClear();

    fireRendered({ index: 3 });

    expect(rendition.annotations.add).not.toHaveBeenCalled();
  });

  it("swallows a throwing annotations.add inside the rendered handler", async () => {
    const reader = await createReader(new ArrayBuffer(8), BASE_SETTINGS);
    await reader.attach(document.createElement("div"));
    reader.addHighlight(CFI_SECTION_3, { id: "h1", styles: {} });
    rendition.annotations.add.mockImplementation(() => {
      throw new Error("mark failed");
    });

    try {
      expect(() => fireRendered({ index: 3 })).not.toThrow();
    } finally {
      rendition.annotations.add.mockReset();
    }
  });
});
