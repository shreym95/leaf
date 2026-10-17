// Reader annotation manager (NOTES_PLAN N1c, N5). The rendition is a fake
// controller and persistence is an injected fake writer, so this file needs no
// Supabase, outbox or design import.

import { describe, expect, it, vi } from "vitest";
import type { Annotation } from "@/lib/types";
import type { ReaderController } from "./engine";
import {
  cfisOverlap,
  compareCfi,
  createAnnotationManager,
  type AnnotationManagerOptions,
} from "./annotations";

// Chapter 4 page-start, then a later offset in the same chapter, then chapter 8.
const PAGE_A = "epubcfi(/6/4!/4/2/1:0)";
const PAGE_B = "epubcfi(/6/4!/4/2/1:100)";
const PAGE_CH8 = "epubcfi(/6/8!/4/2/1:0)";
const RANGE_1 = "epubcfi(/6/4!/4/2,/1:10,/1:20)";
const RANGE_1_OVERLAP = "epubcfi(/6/4!/4/2,/1:15,/1:30)";
const RANGE_2 = "epubcfi(/6/4!/4/2,/1:40,/1:50)";

const STYLES_A = { background: "var(--leaf-hl-a)" };
const STYLES_B = { background: "var(--leaf-hl-b)" };

function row(
  id: string,
  kind: Annotation["kind"],
  cfi: string,
  quote: string | null = null,
): Annotation {
  const at = "2026-10-01T00:00:00.000Z";
  return {
    id,
    user_id: "u1",
    book_id: "b1",
    kind,
    cfi,
    quote,
    note: null,
    label: null,
    percent: null,
    created_at: at,
    updated_at: at,
  };
}

function fakeController(opts: { throwAdd?: boolean; throwRemove?: boolean } = {}) {
  const addHighlight = vi.fn(() => {
    if (opts.throwAdd) throw new Error("rendition gone");
  });
  const removeHighlight = vi.fn(() => {
    if (opts.throwRemove) throw new Error("rendition gone");
  });
  const controller = {
    addHighlight,
    removeHighlight,
  } as unknown as ReaderController;
  return { controller, addHighlight, removeHighlight };
}

function fakeWriter() {
  return {
    create: vi.fn(async () => {}),
    setNote: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
}

function makeManager(
  overrides: Partial<AnnotationManagerOptions> & {
    controllerOpts?: { throwAdd?: boolean; throwRemove?: boolean };
  } = {},
) {
  const ctl = fakeController(overrides.controllerOpts);
  const writer = fakeWriter();
  let styles: Record<string, string> = STYLES_A;
  const opts: AnnotationManagerOptions = {
    controller: ctl.controller,
    bookId: "b1",
    userId: "u1",
    load: async () => [],
    writer,
    stylesFor: () => styles,
    newId: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
    ...overrides,
  };
  const manager = createAnnotationManager(opts);
  return {
    manager,
    writer,
    ...ctl,
    setStyles(next: Record<string, string>) {
      styles = next;
    },
  };
}

describe("compareCfi and cfisOverlap (pure)", () => {
  it("orders by chapter, then offset, with a range sorting by its start", () => {
    expect(compareCfi(PAGE_A, PAGE_B)).toBeLessThan(0);
    expect(compareCfi(PAGE_B, PAGE_CH8)).toBeLessThan(0);
    expect(compareCfi(RANGE_1, PAGE_B)).toBeLessThan(0);
    expect(compareCfi(PAGE_A, RANGE_1)).toBeLessThan(0);
    expect(compareCfi(PAGE_A, PAGE_A)).toBe(0);
  });

  it("treats ranges sharing any position as overlapping, and disjoint ones as not", () => {
    expect(cfisOverlap(RANGE_1, RANGE_1_OVERLAP)).toBe(true);
    expect(cfisOverlap(RANGE_1, RANGE_2)).toBe(false);
    expect(cfisOverlap(RANGE_1, PAGE_B.replace("100", "15"))).toBe(true);
    expect(cfisOverlap("not-a-cfi", "not-a-cfi")).toBe(true);
    expect(cfisOverlap("not-a-cfi", RANGE_1)).toBe(false);
  });
});

describe("restore", () => {
  it("paints only ranges, with the styles from stylesFor, and lists both kinds by position", async () => {
    const { manager, addHighlight } = makeManager({
      load: async () => [
        row("p-b", "page", PAGE_B),
        row("r-1", "range", RANGE_1, "a quote"),
        row("p-a", "page", PAGE_A),
      ],
    });

    const list = await manager.restore();

    expect(list.map((a) => a.id)).toEqual(["p-a", "r-1", "p-b"]);
    expect(addHighlight).toHaveBeenCalledTimes(1);
    expect(addHighlight).toHaveBeenCalledWith(RANGE_1, {
      id: "r-1",
      styles: STYLES_A,
      onClick: undefined,
    });
  });

  it("notifies subscribers and keeps the loaded list when load fails", async () => {
    const { manager } = makeManager({
      load: async () => {
        throw new Error("offline");
      },
    });
    const seen: Annotation[][] = [];
    manager.subscribe((l) => seen.push(l));

    await expect(manager.restore()).resolves.toEqual([]);
    expect(seen).toHaveLength(1);
  });
});

describe("page marks", () => {
  it("toggles one page mark per CFI: create, then remove at the same CFI", async () => {
    const { manager, writer } = makeManager();

    const created = await manager.markPage({ cfi: PAGE_A, label: "Ch. 1", percent: 0.1 });
    expect(created).toMatchObject({ kind: "page", cfi: PAGE_A, quote: null, label: "Ch. 1", percent: 0.1 });
    expect(manager.isMarked(PAGE_A)).toBe(true);
    expect(writer.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "page", cfi: PAGE_A }));

    const toggledOff = await manager.markPage({ cfi: PAGE_A });
    expect(toggledOff).toBeNull();
    expect(manager.isMarked(PAGE_A)).toBe(false);
    expect(manager.list()).toEqual([]);
    expect(writer.remove).toHaveBeenCalledWith("id-1");
  });

  it("never paints a page mark", async () => {
    const { manager, addHighlight } = makeManager();
    await manager.markPage({ cfi: PAGE_A });
    expect(addHighlight).not.toHaveBeenCalled();
  });
});

describe("highlight", () => {
  it("creates a range, paints it and persists it", async () => {
    const { manager, writer, addHighlight } = makeManager();

    const h = await manager.highlight({ cfiRange: RANGE_1, quote: "the quoted text" });

    expect(h).toMatchObject({ kind: "range", cfi: RANGE_1, quote: "the quoted text" });
    expect(addHighlight).toHaveBeenCalledWith(RANGE_1, expect.objectContaining({ id: "id-1", styles: STYLES_A }));
    expect(writer.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "range", quote: "the quoted text" }));
  });

  it("returns the existing highlight when the new range overlaps it, with no write and no paint", async () => {
    const { manager, writer, addHighlight } = makeManager();
    const first = await manager.highlight({ cfiRange: RANGE_1, quote: "first" });

    const second = await manager.highlight({ cfiRange: RANGE_1_OVERLAP, quote: "second" });

    expect(second?.id).toBe(first?.id);
    expect(manager.list()).toHaveLength(1);
    expect(writer.create).toHaveBeenCalledTimes(1);
    expect(addHighlight).toHaveBeenCalledTimes(1);
  });

  it("creates a second highlight for a disjoint range", async () => {
    const { manager, addHighlight } = makeManager();
    await manager.highlight({ cfiRange: RANGE_1, quote: "first" });
    await manager.highlight({ cfiRange: RANGE_2, quote: "second" });
    expect(manager.list()).toHaveLength(2);
    expect(addHighlight).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty or over-long quote before any state change", async () => {
    const { manager, writer } = makeManager();
    await expect(manager.highlight({ cfiRange: RANGE_1, quote: "" })).rejects.toThrow(RangeError);
    await expect(
      manager.highlight({ cfiRange: RANGE_1, quote: "x".repeat(5001) }),
    ).rejects.toThrow(RangeError);
    expect(manager.list()).toEqual([]);
    expect(writer.create).not.toHaveBeenCalled();
  });
});

describe("setNote", () => {
  it("sets and clears a note, and rejects notes outside 1–500 characters", async () => {
    const { manager, writer } = makeManager();
    const h = await manager.highlight({ cfiRange: RANGE_1, quote: "q" });
    const id = h!.id;

    await manager.setNote(id, "a thought");
    expect(manager.list()[0].note).toBe("a thought");
    expect(writer.setNote).toHaveBeenLastCalledWith(id, "a thought");

    await manager.setNote(id, null);
    expect(manager.list()[0].note).toBeNull();

    await expect(manager.setNote(id, "")).rejects.toThrow(RangeError);
    await expect(manager.setNote(id, "n".repeat(501))).rejects.toThrow(RangeError);
    expect(manager.list()[0].note).toBeNull();
    expect(writer.setNote).toHaveBeenCalledTimes(2);
  });

  it("accepts a note of exactly 500 characters", async () => {
    const { manager } = makeManager();
    const h = await manager.highlight({ cfiRange: RANGE_1, quote: "q" });
    await manager.setNote(h!.id, "n".repeat(500));
    expect(manager.list()[0].note).toHaveLength(500);
  });

  it("is a no-op for an unknown id", async () => {
    const { manager, writer } = makeManager();
    await manager.setNote("missing", "text");
    expect(writer.setNote).not.toHaveBeenCalled();
  });
});

describe("remove", () => {
  it("un-paints a removed range", async () => {
    const { manager, writer, removeHighlight } = makeManager();
    const h = await manager.highlight({ cfiRange: RANGE_1, quote: "q" });

    await manager.remove(h!.id);

    expect(removeHighlight).toHaveBeenCalledWith(RANGE_1);
    expect(manager.list()).toEqual([]);
    expect(writer.remove).toHaveBeenCalledWith(h!.id);
  });

  it("removes a page mark without touching the rendition", async () => {
    const { manager, removeHighlight } = makeManager();
    await manager.markPage({ cfi: PAGE_A });
    await manager.remove("id-1");
    expect(removeHighlight).not.toHaveBeenCalled();
    expect(manager.isMarked(PAGE_A)).toBe(false);
  });
});

describe("repaint", () => {
  it("re-applies stylesFor() to every painted range", async () => {
    const { manager, setStyles, addHighlight, removeHighlight } = makeManager();
    await manager.highlight({ cfiRange: RANGE_1, quote: "q" });
    addHighlight.mockClear();

    setStyles(STYLES_B);
    manager.repaint();

    expect(removeHighlight).toHaveBeenLastCalledWith(RANGE_1);
    expect(addHighlight).toHaveBeenCalledWith(RANGE_1, expect.objectContaining({ styles: STYLES_B }));
  });
});

describe("subscribe and tap", () => {
  it("notifies on each change and stops after unsubscribe", async () => {
    const { manager } = makeManager();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);

    await manager.markPage({ cfi: PAGE_A });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await manager.markPage({ cfi: PAGE_B });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("calls onHighlightTap with the range when its painted highlight is clicked", async () => {
    const onHighlightTap = vi.fn();
    const { manager, addHighlight } = makeManager({ onHighlightTap });
    const h = await manager.highlight({ cfiRange: RANGE_1, quote: "q" });

    const onClick = (addHighlight.mock.calls[0] as unknown as [string, { onClick: () => void }])[1].onClick;
    onClick();

    expect(onHighlightTap).toHaveBeenCalledWith(expect.objectContaining({ id: h!.id, cfi: RANGE_1 }));
  });
});

describe("ids", () => {
  it("defaults to a random UUID when newId is not given", async () => {
    const { manager } = makeManager({ newId: undefined });
    const h = await manager.highlight({ cfiRange: RANGE_1, quote: "q" });
    expect(h!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("N5: a failing write or controller never breaks reading", () => {
  it("keeps the optimistic state when the writer throws and when it rejects", async () => {
    const writer = {
      create: vi.fn(() => {
        throw new Error("network down");
      }),
      setNote: vi.fn(async () => {
        throw new Error("rejected");
      }),
      remove: vi.fn(async () => {
        throw new Error("rejected");
      }),
    };
    const { manager } = makeManager({ writer });

    await expect(manager.markPage({ cfi: PAGE_A })).resolves.toMatchObject({ cfi: PAGE_A });
    const h = await manager.highlight({ cfiRange: RANGE_1, quote: "q" });
    await expect(manager.setNote(h!.id, "still works")).resolves.toBeUndefined();
    await expect(manager.remove(h!.id)).resolves.toBeUndefined();

    expect(manager.isMarked(PAGE_A)).toBe(true);
    expect(manager.list().map((a) => a.kind)).toEqual(["page"]);
  });

  it("stays usable when the rendition throws on paint and un-paint", async () => {
    const { manager } = makeManager({ controllerOpts: { throwAdd: true, throwRemove: true } });

    const h = await manager.highlight({ cfiRange: RANGE_1, quote: "q" });
    expect(h).not.toBeNull();
    await expect(manager.remove(h!.id)).resolves.toBeUndefined();

    await manager.markPage({ cfi: PAGE_B });
    expect(manager.isMarked(PAGE_B)).toBe(true);
  });

  it("restores to an empty, usable list when load throws", async () => {
    const { manager } = makeManager({
      load: async () => {
        throw new Error("offline");
      },
    });
    await manager.restore();
    await manager.markPage({ cfi: PAGE_A });
    expect(manager.isMarked(PAGE_A)).toBe(true);
  });

  it("does not throw when a subscriber throws", async () => {
    const { manager } = makeManager();
    manager.subscribe(() => {
      throw new Error("bad subscriber");
    });
    await expect(manager.markPage({ cfi: PAGE_A })).resolves.toBeTruthy();
  });
});

describe("restore races", () => {
  it("keeps an item created while load is in flight", async () => {
    let resolveLoad: (rows: Annotation[]) => void = () => {};
    const { manager } = makeManager({
      load: () => new Promise<Annotation[]>((r) => (resolveLoad = r)),
    });

    const pending = manager.restore();
    await manager.markPage({ cfi: PAGE_A });
    resolveLoad([row("srv-1", "page", PAGE_B)]);
    const list = await pending;

    expect(list.map((a) => a.cfi)).toEqual([PAGE_A, PAGE_B]);
  });

  it("does not bring back an item removed while a second restore is in flight", async () => {
    let rows: Annotation[] = [row("srv-1", "page", PAGE_A)];
    let resolveLoad: (r: Annotation[]) => void = () => {};
    const { manager } = makeManager({
      load: () => (rows.length ? Promise.resolve(rows) : new Promise((r) => (resolveLoad = r))),
    });
    await manager.restore();
    expect(manager.isMarked(PAGE_A)).toBe(true);

    rows = [];
    const pending = manager.restore();
    await manager.remove("srv-1");
    resolveLoad([row("srv-1", "page", PAGE_A)]);
    const list = await pending;

    expect(list).toEqual([]);
  });
});

describe("destroy", () => {
  it("un-paints every range and turns later mutations into no-ops", async () => {
    const { manager, removeHighlight, writer } = makeManager();
    await manager.highlight({ cfiRange: RANGE_1, quote: "q" });

    manager.destroy();

    expect(removeHighlight).toHaveBeenCalledWith(RANGE_1);
    expect(await manager.highlight({ cfiRange: RANGE_2, quote: "q" })).toBeNull();
    expect(await manager.markPage({ cfi: PAGE_A })).toBeNull();
    expect(writer.create).toHaveBeenCalledTimes(1);
  });
});
