import { describe, expect, it } from "vitest";
import {
  END_FRACTION_THRESHOLD,
  buildOutline,
  milestonePoints,
  pointsReached,
} from "./outline";
import type { TocInput } from "./types";

const flat = (n: number): TocInput[] =>
  Array.from({ length: n }, (_, i) => ({
    href: `ch${i + 1}.xhtml`,
    label: `Chapter ${i + 1}`,
  }));

const middlemarch: TocInput[] = [
  { href: "titlepage.xhtml", label: "Title Page" },
  {
    href: "book-1.xhtml",
    label: "Book I: Miss Brooke",
    subitems: [
      { href: "ch-1.xhtml", label: "Chapter 1" },
      { href: "ch-2.xhtml", label: "Chapter 2" },
    ],
  },
  {
    href: "book-2.xhtml",
    label: "Book II: Old and Young",
    subitems: [
      { href: "ch-3.xhtml", label: "Chapter 3" },
      { href: "ch-4.xhtml", label: "Chapter 4" },
    ],
  },
  { href: "finale.xhtml", label: "Finale" },
];

describe("buildOutline", () => {
  it("flattens a flat TOC in order with indices and no Parts", () => {
    const o = buildOutline(flat(3));
    expect(o.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(o.map((e) => e.label)).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"]);
    expect(o.every((e) => e.partIndex === null && e.depth === 0)).toBe(true);
    expect(o[1].href).toBe("ch2.xhtml");
  });

  it("detects Parts: children become chapters tagged with the Part ordinal", () => {
    const o = buildOutline(middlemarch);
    expect(o.map((e) => e.label)).toEqual([
      "Title Page",
      "Chapter 1",
      "Chapter 2",
      "Chapter 3",
      "Chapter 4",
      "Finale",
    ]);
    expect(o.map((e) => e.partIndex)).toEqual([null, 0, 0, 1, 1, null]);
    expect(o.map((e) => e.depth)).toEqual([0, 1, 1, 1, 1, 0]);
    expect(o[1].partLabel).toBe("Book I: Miss Brooke");
    expect(o[3].partLabel).toBe("Book II: Old and Young");
    expect(o[0].partLabel).toBeNull();
    // the Part entry itself is not a chapter
    expect(o.some((e) => e.href === "book-1.xhtml")).toBe(false);
  });

  it("skips blank and whitespace-only labels and trims the rest", () => {
    const o = buildOutline([
      { href: "a.xhtml", label: "  A  " },
      { href: "b.xhtml", label: "   " },
      { href: "c.xhtml", label: "" },
      { href: "d.xhtml", label: "D" },
    ]);
    expect(o.map((e) => e.label)).toEqual(["A", "D"]);
    expect(o.map((e) => e.index)).toEqual([0, 1]);
  });

  it("treats a Part whose children are all blank as a plain chapter", () => {
    const o = buildOutline([
      { href: "p.xhtml", label: "Prologue", subitems: [{ href: "x", label: " " }] },
    ]);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ label: "Prologue", partIndex: null, depth: 0 });
  });

  it("flattens deeper nesting depth-first, inheriting the Part", () => {
    const o = buildOutline([
      {
        href: "p1",
        label: "Part One",
        subitems: [
          {
            href: "c1",
            label: "C1",
            subitems: [{ href: "c1a", label: "C1a" }],
          },
          { href: "c2", label: "C2" },
        ],
      },
    ]);
    expect(o.map((e) => [e.label, e.depth, e.partIndex])).toEqual([
      ["C1", 1, 0],
      ["C1a", 2, 0],
      ["C2", 1, 0],
    ]);
  });

  it("returns an empty outline for an empty TOC", () => {
    expect(buildOutline([])).toEqual([]);
  });

  it("accepts the reader's TOC shape structurally", () => {
    const readerToc: Array<{ href: string; label: string }> = [
      { href: "a", label: "A" },
    ];
    expect(buildOutline(readerToc)).toHaveLength(1);
  });
});

describe("milestonePoints", () => {
  it("without Parts: half and end only", () => {
    const pts = milestonePoints(buildOutline(flat(10)));
    expect(pts.map((p) => p.point)).toEqual(["half", "end"]);
    expect(pts[0]).toMatchObject({ chapterIndex: 5, chapterFraction: 0 });
    expect(pts[1]).toMatchObject({
      chapterIndex: 9,
      chapterFraction: END_FRACTION_THRESHOLD,
    });
  });

  it("with Parts: one part:<n> per Part at its first chapter, then half and end", () => {
    const pts = milestonePoints(buildOutline(middlemarch)); // 6 chapters
    // part:1 and half both sit at chapter 3: Parts sort before half
    expect(pts.map((p) => p.point)).toEqual(["part:0", "part:1", "half", "end"]);
    expect(pts[0]).toMatchObject({ chapterIndex: 1, label: "Book I: Miss Brooke" });
    expect(pts[1]).toMatchObject({ chapterIndex: 3, label: "Book II: Old and Young" });
    expect(pts[2]).toMatchObject({ chapterIndex: 3, label: null });
  });

  it("is empty for an empty outline; a one-chapter book has only end", () => {
    expect(milestonePoints([])).toEqual([]);
    expect(milestonePoints(buildOutline(flat(1))).map((p) => p.point)).toEqual(["end"]);
  });
});

describe("pointsReached", () => {
  const o = buildOutline(middlemarch);

  it("reaches nothing before the first point (no Parts, start of a flat book)", () => {
    expect(pointsReached(buildOutline(flat(10)), { chapterIndex: 0, chapterFraction: 0 })).toEqual([]);
  });

  it("reaches a Part at the start of its first chapter", () => {
    expect(pointsReached(o, { chapterIndex: 0, chapterFraction: 0.9 })).toEqual([]);
    expect(pointsReached(o, { chapterIndex: 1, chapterFraction: 0 })).toEqual(["part:0"]);
  });

  it("accumulates points as the position advances", () => {
    expect(pointsReached(o, { chapterIndex: 3, chapterFraction: 0 })).toEqual([
      "part:0",
      "part:1",
      "half",
    ]);
  });

  it("end needs the last chapter at the threshold", () => {
    const last = o.length - 1;
    expect(
      pointsReached(o, { chapterIndex: last, chapterFraction: END_FRACTION_THRESHOLD - 0.01 }),
    ).not.toContain("end");
    expect(
      pointsReached(o, { chapterIndex: last, chapterFraction: END_FRACTION_THRESHOLD }),
    ).toContain("end");
    expect(pointsReached(o, { chapterIndex: last, chapterFraction: 1 })).toEqual([
      "part:0",
      "part:1",
      "half",
      "end",
    ]);
  });

  it("does not reach end from the second-to-last chapter, however far in", () => {
    expect(pointsReached(o, { chapterIndex: o.length - 2, chapterFraction: 1 })).not.toContain("end");
  });

  it("clamps out-of-range fractions and tolerates junk", () => {
    const last = o.length - 1;
    expect(pointsReached(o, { chapterIndex: last, chapterFraction: 7 })).toContain("end");
    expect(pointsReached(o, { chapterIndex: last, chapterFraction: -3 })).not.toContain("end");
    expect(pointsReached(o, { chapterIndex: last, chapterFraction: NaN })).not.toContain("end");
    expect(pointsReached(o, { chapterIndex: -1, chapterFraction: 1 })).toEqual([]);
  });

  it("a position past the last chapter has reached everything", () => {
    expect(pointsReached(o, { chapterIndex: 99, chapterFraction: 0 })).toContain("end");
  });

  it("returns nothing for an empty outline", () => {
    expect(pointsReached([], { chapterIndex: 0, chapterFraction: 1 })).toEqual([]);
  });
});
