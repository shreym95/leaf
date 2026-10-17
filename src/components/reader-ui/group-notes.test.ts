import { describe, expect, it } from "vitest";
import type { Alignment, Outline } from "@/lib/groups/types";
import type { VisibleReadNote } from "@/lib/types";
import {
  buildNoteSections,
  canSaveNote,
  chapterStartHref,
  noteJump,
  noteLength,
  outlinePositionFor,
  type GroupReadContext,
} from "./group-notes";

const outline: Outline = [
  { index: 0, label: "One", depth: 0, partIndex: null, partLabel: null, href: "o1.xhtml" },
  { index: 1, label: "Two", depth: 0, partIndex: null, partLabel: null, href: "o2.xhtml" },
  { index: 2, label: "Three", depth: 0, partIndex: null, partLabel: null, href: "o3.xhtml" },
];

const alignment: Alignment = {
  map: { "c1.html": 0, "c2.html": 1 },
  copyHrefs: ["c1.html", "c2.html"],
  confidence: 2 / 3,
  identity: false,
};

function read(over: Partial<GroupReadContext> = {}): GroupReadContext {
  return {
    readId: "r1",
    groupId: "g1",
    groupName: "Book Club",
    outline,
    alignment,
    copySha256: "sha-mine",
    names: new Map([["u-ann", "Ann"]]),
    ...over,
  };
}

function note(over: Partial<VisibleReadNote> = {}): VisibleReadNote {
  return {
    id: "n1",
    read_id: "r1",
    user_id: "u-ann",
    chapter_index: 0,
    chapter_fraction: 0.5,
    kind: "mark",
    note: null,
    cfi: "epubcfi(/6/2)",
    content_sha256: "sha-mine",
    created_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

describe("note length", () => {
  it("counts trimmed code points, so 0 and 501 are rejected and 500 is accepted", () => {
    expect(noteLength("   ")).toBe(0);
    expect(canSaveNote("")).toBe(false);
    expect(canSaveNote("   ")).toBe(false);
    expect(canSaveNote("a".repeat(501))).toBe(false);
    expect(canSaveNote("a".repeat(500))).toBe(true);
    expect(canSaveNote(`${"😀".repeat(500)}`)).toBe(true);
    expect(canSaveNote(`x${"😀".repeat(500)}`)).toBe(false);
  });
});

describe("outlinePositionFor", () => {
  it("maps the reader's spine href and section fraction into outline coordinates", () => {
    expect(
      outlinePositionFor(read(), { spineHref: "c2.html", sectionFraction: 0.25 }),
    ).toEqual({ chapterIndex: 1, chapterFraction: 0.25 });
  });

  it("falls back to a unique same-name file, as the progress tracker does", () => {
    expect(
      outlinePositionFor(read(), { spineHref: "OEBPS/c2.html", sectionFraction: 0 }),
    ).toEqual({ chapterIndex: 1, chapterFraction: 0 });
  });

  it("is null when the place is unknown or the copy does not map it", () => {
    expect(outlinePositionFor(read(), null)).toBeNull();
    expect(outlinePositionFor(read(), { spineHref: "c2.html" })).toBeNull();
    expect(outlinePositionFor(read(), { spineHref: "x.html", sectionFraction: 0 })).toBeNull();
    expect(outlinePositionFor(read({ alignment: null }), { spineHref: "c2.html", sectionFraction: 0 })).toBeNull();
  });
});

describe("chapterStartHref", () => {
  it("returns my copy's href for an outline chapter when the mapping round-trips", () => {
    expect(chapterStartHref(read(), 1)).toBe("c2.html");
  });

  it("is null for a chapter my copy lacks", () => {
    expect(chapterStartHref(read(), 2)).toBeNull();
  });

  it("is null when two fragments share a file and the mapping does not round-trip", () => {
    const shared = read({
      alignment: {
        map: { "a.html#x": 0, "a.html#y": 1 },
        copyHrefs: ["a.html#x", "a.html#y"],
        confidence: 1,
        identity: false,
      },
    });
    expect(chapterStartHref(shared, 1)).toBeNull();
    expect(chapterStartHref(shared, 0)).toBe("a.html#x");
  });
});

describe("noteJump", () => {
  it("jumps to the CFI when the copy hash matches and a CFI is set", () => {
    expect(noteJump(read(), note())).toEqual({ kind: "exact", target: "epubcfi(/6/2)" });
  });

  it("falls back to the chapter start when the hash differs or there is no CFI", () => {
    expect(noteJump(read(), note({ content_sha256: "other" }))).toEqual({
      kind: "chapter",
      target: "c1.html",
    });
    expect(noteJump(read(), note({ cfi: null }))).toEqual({ kind: "chapter", target: "c1.html" });
  });

  it("is null when the chapter cannot be placed in my copy", () => {
    expect(noteJump(read(), note({ chapter_index: 2, content_sha256: "other" }))).toBeNull();
    expect(noteJump(read({ alignment: null }), note({ content_sha256: "other" }))).toBeNull();
  });
});

describe("buildNoteSections", () => {
  it("orders chapters by outline index and keeps the RPC order within a chapter", () => {
    const sections = buildNoteSections(
      [read()],
      new Map([
        [
          "r1",
          [
            note({ id: "late", chapter_index: 1 }),
            note({ id: "a", chapter_index: 0 }),
            note({ id: "b", chapter_index: 0 }),
          ],
        ],
      ]),
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].chapters.map((c) => [c.label, c.rows.map((r) => r.note.id)])).toEqual([
      ["One", ["a", "b"]],
      ["Two", ["late"]],
    ]);
  });
});
