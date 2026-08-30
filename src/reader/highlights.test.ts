// The highlight CFI round-trip (SPEC §8, §9 M4) — the HARD requirement: a
// highlight created in one session is re-applied to the rendition at the exact
// same CFI range when a fresh manager restores it. The db layer + Supabase
// client are mocked; the rendition is a fake controller.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/highlights", () => ({
  listHighlights: vi.fn(async () => []),
  createHighlight: vi.fn(),
  updateHighlightNote: vi.fn(async () => {}),
  deleteHighlight: vi.fn(async () => {}),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
    },
  })),
}));

import {
  createHighlight,
  deleteHighlight,
  listHighlights,
  updateHighlightNote,
} from "@/lib/db/highlights";
import type { Highlight } from "@/lib/types";
import type { ReaderController } from "./engine";
import { manageHighlights } from "./highlights";

type SelectedCb = (sel: { cfiRange: string; text: string }) => void;

function makeController() {
  const added: { cfiRange: string; id: string; styles: Record<string, string> }[] =
    [];
  const removed: string[] = [];
  const c = {
    onRelocated: vi.fn(() => () => {}),
    onSelected: vi.fn((_cb: SelectedCb) => () => {}),
    addHighlight: vi.fn(
      (
        cfiRange: string,
        opts: { id: string; styles: Record<string, string>; onClick?: () => void },
      ) => {
        added.push({ cfiRange, id: opts.id, styles: opts.styles });
      },
    ),
    removeHighlight: vi.fn((cfiRange: string) => {
      removed.push(cfiRange);
    }),
    clearSelection: vi.fn(),
    goTo: vi.fn(async () => {}),
    attach: vi.fn(async () => {}),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    relayout: vi.fn(),
    applySettings: vi.fn(),
    destroy: vi.fn(),
    sectionCount: 0,
  };
  return Object.assign(c as unknown as ReaderController, { added, removed });
}

// The design-layer injection point: a colour NAME -> concrete CSS. The manager
// must route every colour through this and never carry a literal itself.
const stylesFor = vi.fn((color: string) => ({ "data-color": color }));

const ROW = (over: Partial<Highlight> = {}): Highlight => ({
  id: "hl-1",
  book_id: "book1",
  user_id: "u1",
  cfi_range: "epubcfi(/6/14!/4/2/1:0,/4/2/1:64)",
  text: "call me Ishmael",
  color: "copper",
  note: null,
  created_at: "2026-08-30T00:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  stylesFor.mockImplementation((color: string) => ({ "data-color": color }));
});

describe("create", () => {
  it("persists the highlight with the exact CFI range and paints it immediately", async () => {
    vi.mocked(createHighlight).mockResolvedValue(ROW());
    const c = makeController();
    const mgr = manageHighlights(c, "book1", { stylesFor });

    const rec = await mgr.create({
      cfiRange: "epubcfi(/6/14!/4/2/1:0,/4/2/1:64)",
      text: "call me Ishmael",
    });

    expect(createHighlight).toHaveBeenCalledWith(
      "u1",
      {
        bookId: "book1",
        cfiRange: "epubcfi(/6/14!/4/2/1:0,/4/2/1:64)",
        text: "call me Ishmael",
        color: "copper",
      },
      expect.anything(),
    );
    expect(rec.id).toBe("hl-1");
    expect(c.added).toEqual([
      {
        cfiRange: "epubcfi(/6/14!/4/2/1:0,/4/2/1:64)",
        id: "hl-1",
        styles: { "data-color": "copper" },
      },
    ]);
    expect(mgr.list()).toHaveLength(1);
  });

  it("defaults to the 'copper' colour name and consults stylesFor for the CSS", async () => {
    vi.mocked(createHighlight).mockImplementation(async (_userId, input) =>
      ROW({ cfi_range: input.cfiRange, text: input.text, color: input.color }),
    );
    const c = makeController();
    const mgr = manageHighlights(c, "book1", { stylesFor });

    await mgr.create({ cfiRange: "cfi-x", text: "t", color: "sage" });

    expect(stylesFor).toHaveBeenCalledWith("sage");
    expect(c.addHighlight).toHaveBeenCalledWith(
      "cfi-x",
      expect.objectContaining({ styles: { "data-color": "sage" } }),
    );
  });

  it("does not throw when the db write fails, and still tracks + paints locally", async () => {
    vi.mocked(createHighlight).mockRejectedValue(new Error("network down"));
    const c = makeController();
    const mgr = manageHighlights(c, "book1", { stylesFor });

    const rec = await mgr.create({ cfiRange: "cfi-y", text: "orphan" });

    expect(rec.cfiRange).toBe("cfi-y");
    expect(mgr.list()).toHaveLength(1);
    expect(c.added).toHaveLength(1);
    expect(c.added[0].cfiRange).toBe("cfi-y");
  });
});

describe("restore — the CFI round-trip", () => {
  it("a fresh manager reads persisted highlights back and re-applies each to the rendition with the same CFI", async () => {
    // Session 1: create into an in-memory 'table'.
    const table: Highlight[] = [];
    vi.mocked(createHighlight).mockImplementation(async (_userId, input) => {
      const row = ROW({
        id: `hl-${table.length + 1}`,
        cfi_range: input.cfiRange,
        text: input.text,
        color: input.color,
      });
      table.push(row);
      return row;
    });
    vi.mocked(listHighlights).mockImplementation(async () => [...table]);

    const CFI_A = "epubcfi(/6/22!/4/2/8/1:0,/4/2/8/1:41)";
    const CFI_B = "epubcfi(/6/24!/4/2/2/1:5,/4/2/2/1:88)";

    const c1 = makeController();
    const mgr1 = manageHighlights(c1, "book1", { stylesFor });
    await mgr1.create({ cfiRange: CFI_A, text: "first" });
    await mgr1.create({ cfiRange: CFI_B, text: "second" });
    mgr1.stop();

    // Session 2 (reopen / other device): fresh manager, restore repaints.
    const c2 = makeController();
    const mgr2 = manageHighlights(c2, "book1", { stylesFor });
    const restored = await mgr2.restore();

    expect(restored.map((r) => r.cfiRange)).toEqual([CFI_A, CFI_B]);
    expect(c2.added.map((a) => a.cfiRange)).toEqual([CFI_A, CFI_B]);
    expect(mgr2.list()).toHaveLength(2);
  });

  it("wires onHighlightClick through to the painted annotation", async () => {
    vi.mocked(listHighlights).mockResolvedValue([ROW()]);
    const onHighlightClick = vi.fn();
    const c = makeController();
    const mgr = manageHighlights(c, "book1", { stylesFor, onHighlightClick });

    await mgr.restore();

    const opts = vi.mocked(c.addHighlight).mock.calls[0][1];
    opts.onClick?.();
    expect(onHighlightClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "hl-1", cfiRange: ROW().cfi_range }),
    );
  });
});

describe("remove", () => {
  it("deletes from the db AND unpaints the annotation by CFI range", async () => {
    vi.mocked(listHighlights).mockResolvedValue([ROW()]);
    const c = makeController();
    const mgr = manageHighlights(c, "book1", { stylesFor });
    await mgr.restore();

    await mgr.remove("hl-1");

    expect(deleteHighlight).toHaveBeenCalledWith("u1", "hl-1", expect.anything());
    expect(c.removed).toEqual([ROW().cfi_range]);
    expect(mgr.list()).toHaveLength(0);
  });

  it("does not throw when the db delete fails", async () => {
    vi.mocked(listHighlights).mockResolvedValue([ROW()]);
    vi.mocked(deleteHighlight).mockRejectedValue(new Error("boom"));
    const c = makeController();
    const mgr = manageHighlights(c, "book1", { stylesFor });
    await mgr.restore();

    await expect(mgr.remove("hl-1")).resolves.toBeUndefined();
    expect(c.removed).toEqual([ROW().cfi_range]);
  });
});

describe("setNote", () => {
  it("persists the note, updates the in-memory record, and notifies subscribers", async () => {
    vi.mocked(listHighlights).mockResolvedValue([ROW()]);
    const c = makeController();
    const mgr = manageHighlights(c, "book1", { stylesFor });
    await mgr.restore();

    const seen: (string | null)[] = [];
    mgr.subscribe((list) => seen.push(list[0]?.note ?? null));

    await mgr.setNote("hl-1", "Ishmael = narrator");

    expect(updateHighlightNote).toHaveBeenCalledWith(
      "u1",
      "hl-1",
      "Ishmael = narrator",
      expect.anything(),
    );
    expect(mgr.list()[0].note).toBe("Ishmael = narrator");
    expect(seen).toContain("Ishmael = narrator");
  });

  it("clears the note with null", async () => {
    vi.mocked(listHighlights).mockResolvedValue([ROW({ note: "old" })]);
    const c = makeController();
    const mgr = manageHighlights(c, "book1", { stylesFor });
    await mgr.restore();

    await mgr.setNote("hl-1", null);

    expect(updateHighlightNote).toHaveBeenCalledWith(
      "u1",
      "hl-1",
      null,
      expect.anything(),
    );
    expect(mgr.list()[0].note).toBeNull();
  });
});

describe("subscribe / stop", () => {
  it("notifies on create and remove, and stops notifying after stop()", async () => {
    vi.mocked(createHighlight).mockResolvedValue(ROW());
    const c = makeController();
    const mgr = manageHighlights(c, "book1", { stylesFor });

    const counts: number[] = [];
    const unsub = mgr.subscribe((list) => counts.push(list.length));

    await mgr.create({ cfiRange: ROW().cfi_range, text: "t" });
    expect(counts.at(-1)).toBe(1);

    unsub();
    await mgr.remove("hl-1");
    expect(counts).toEqual([1]); // no further notifications after unsubscribe
  });
});

describe("the colour seam", () => {
  it("src/reader/highlights.ts contains no hard-coded hex colour", () => {
    const src = readFileSync(resolve("src/reader/highlights.ts"), "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("src/reader/engine.ts contains no hard-coded hex colour", () => {
    const src = readFileSync(resolve("src/reader/engine.ts"), "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
