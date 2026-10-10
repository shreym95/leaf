import { describe, expect, it } from "vitest";
import {
  alignCopy,
  fromOutlinePosition,
  normaliseLabel,
  toOutlinePosition,
} from "./alignment";
import { buildOutline } from "./outline";
import type { TocInput } from "./types";

const toc = (labels: string[], prefix = "ch"): TocInput[] =>
  labels.map((label, i) => ({ href: `${prefix}${i + 1}.xhtml`, label }));

describe("normaliseLabel", () => {
  it("lowercases, trims, collapses whitespace and strips punctuation", () => {
    expect(normaliseLabel("  The   Dormouse's \"Tale\"! ")).toBe("the dormouses tale");
  });

  it("strips a leading chapter/ch./part/book/letter", () => {
    expect(normaliseLabel("Chapter 1")).toBe("1");
    expect(normaliseLabel("CH. 7")).toBe("7");
    expect(normaliseLabel("Part Two")).toBe("2");
    expect(normaliseLabel("Book I: Miss Brooke")).toBe("1 miss brooke");
    expect(normaliseLabel("Letter 4")).toBe("4");
  });

  it("keeps a prefix word that is the whole label", () => {
    expect(normaliseLabel("Part")).toBe("part");
  });

  it("maps number words one to twenty", () => {
    expect(normaliseLabel("Chapter One")).toBe("1");
    expect(normaliseLabel("twelve")).toBe("12");
    expect(normaliseLabel("Chapter Twenty")).toBe("20");
  });

  it("maps Roman numerals I to C, and only canonical ones", () => {
    const romans: Array<[string, string]> = [
      ["I", "1"], ["IV", "4"], ["IX", "9"], ["XIV", "14"], ["XL", "40"],
      ["XLIX", "49"], ["L", "50"], ["LXXXIV", "84"], ["XC", "90"], ["C", "100"],
    ];
    for (const [r, n] of romans) expect(normaliseLabel(`Chapter ${r}`)).toBe(n);
    expect(normaliseLabel("Chapter L")).toBe("50");
    expect(normaliseLabel("IIII")).toBe("iiii");
    expect(normaliseLabel("civil")).toBe("civil");
  });

  it("makes \"Chapter I\", \"1\" and \"Chapter One\" identical", () => {
    const a = normaliseLabel("Chapter I");
    expect(a).toBe("1");
    expect(normaliseLabel("1")).toBe(a);
    expect(normaliseLabel("Chapter One")).toBe(a);
    expect(normaliseLabel("Ch. 1.")).toBe(a);
  });

  it("handles accents and empties", () => {
    expect(normaliseLabel("Épilogue")).toBe("epilogue");
    expect(normaliseLabel("***")).toBe("");
    expect(normaliseLabel("   ")).toBe("");
  });
});

describe("alignCopy", () => {
  const outline = buildOutline(
    toc(["Chapter I", "Chapter II", "Chapter III", "Chapter IV"]),
  );

  it("identical TOCs give an identity alignment with confidence 1", () => {
    const a = alignCopy(toc(["Chapter I", "Chapter II", "Chapter III", "Chapter IV"]), outline);
    expect(a.identity).toBe(true);
    expect(a.confidence).toBe(1);
    expect(a.map).toEqual({
      "ch1.xhtml": 0, "ch2.xhtml": 1, "ch3.xhtml": 2, "ch4.xhtml": 3,
    });
  });

  it("same labels but different hrefs is not identity, still confidence 1", () => {
    const a = alignCopy(
      toc(["Chapter I", "Chapter II", "Chapter III", "Chapter IV"], "text/c"),
      outline,
    );
    expect(a.identity).toBe(false);
    expect(a.confidence).toBe(1);
    expect(a.map["text/c3.xhtml"]).toBe(2);
  });

  it("matches renamed labels: Chapter I vs 1 vs Chapter One", () => {
    const a = alignCopy(toc(["1", "Chapter Two", "III", "Ch. 4"], "x"), outline);
    expect(a.identity).toBe(false);
    expect(a.confidence).toBe(1);
    expect(Object.values(a.map)).toEqual([0, 1, 2, 3]);
  });

  it("matches a bare number to a numbered, titled chapter", () => {
    const titled = buildOutline(toc(["I. Down the Rabbit-Hole", "II. The Pool of Tears"]));
    const a = alignCopy(toc(["Chapter 1", "Chapter 2"], "x"), titled);
    expect(a.confidence).toBe(1);
  });

  it("does not match unrelated labels", () => {
    const a = alignCopy(toc(["Prologue", "Aftermath"], "x"), outline);
    expect(a.confidence).toBe(0);
    expect(a.map).toEqual({});
    expect(a.copyHrefs).toEqual(["x1.xhtml", "x2.xhtml"]);
  });

  it("an extra front-matter entry in the copy maps to nothing and does not shift the rest", () => {
    const copy = toc(["Cover", "Chapter I", "Chapter II", "Chapter III", "Chapter IV"], "x");
    const a = alignCopy(copy, outline);
    expect(a.identity).toBe(false);
    expect(a.confidence).toBe(1);
    expect(a.map["x1.xhtml"]).toBeUndefined();
    expect(a.map["x2.xhtml"]).toBe(0);
    expect(a.map["x5.xhtml"]).toBe(3);
    expect(a.copyHrefs).toHaveLength(5);
  });

  it("a copy missing chapters has confidence matched/outline length", () => {
    const a = alignCopy(toc(["Chapter I", "Chapter III"], "x"), outline);
    expect(a.confidence).toBe(0.5);
    expect(a.map).toEqual({ "x1.xhtml": 0, "x2.xhtml": 2 });
  });

  it("preserves order: crossed entries cannot both match", () => {
    const a = alignCopy(toc(["Chapter III", "Chapter II"], "x"), outline);
    expect(a.confidence).toBe(0.25);
    expect(Object.keys(a.map)).toHaveLength(1);
  });

  it("Parts -> Chapters nesting (Middlemarch style) against a flat copy", () => {
    const nested = buildOutline([
      {
        href: "b1.xhtml",
        label: "Book I: Miss Brooke",
        subitems: [
          { href: "c1.xhtml", label: "Chapter I" },
          { href: "c2.xhtml", label: "Chapter II" },
        ],
      },
      {
        href: "b2.xhtml",
        label: "Book II: Old and Young",
        subitems: [{ href: "c3.xhtml", label: "Chapter III" }],
      },
    ]);
    const flatCopy: TocInput[] = [
      { href: "t/1.xhtml", label: "1" },
      { href: "t/2.xhtml", label: "2" },
      { href: "t/3.xhtml", label: "3" },
    ];
    const a = alignCopy(flatCopy, nested);
    expect(a.confidence).toBe(1);
    expect(a.map).toEqual({ "t/1.xhtml": 0, "t/2.xhtml": 1, "t/3.xhtml": 2 });

    // and the reverse: nested copy against a flat outline
    const nestedCopy: TocInput[] = [
      {
        href: "b1.xhtml",
        label: "Book I",
        subitems: [
          { href: "c1.xhtml", label: "Chapter 1" },
          { href: "c2.xhtml", label: "Chapter 2" },
        ],
      },
    ];
    const b = alignCopy(nestedCopy, buildOutline(toc(["Chapter One", "Chapter Two"])));
    expect(b.confidence).toBe(1);
    expect(b.map).toEqual({ "c1.xhtml": 0, "c2.xhtml": 1 });
  });

  it("works with Roman numerals up to L", () => {
    const roman = (n: number): string => {
      const t: Array<[number, string]> = [[50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
      let out = "";
      for (const [v, s] of t) while (n >= v) { out += s; n -= v; }
      return out;
    };
    const nums = Array.from({ length: 50 }, (_, i) => i + 1);
    const o = buildOutline(toc(nums.map((n) => `Chapter ${roman(n)}`)));
    const a = alignCopy(toc(nums.map(String), "x"), o);
    expect(a.confidence).toBe(1);
    expect(a.map["x50.xhtml"]).toBe(49);
    expect(a.map["x14.xhtml"]).toBe(13);
  });

  it("a copy with no TOC has confidence 0 and an empty map", () => {
    for (const none of [[], undefined, null]) {
      const a = alignCopy(none, outline);
      expect(a).toEqual({ map: {}, copyHrefs: [], confidence: 0, identity: false });
    }
  });

  it("a blank-labelled TOC counts as no TOC; an empty outline gives confidence 0", () => {
    expect(alignCopy([{ href: "a", label: " " }], outline).confidence).toBe(0);
    expect(alignCopy(toc(["Chapter I"]), []).confidence).toBe(0);
  });

  it("is JSON-safe (stored in read_copies.alignment)", () => {
    const a = alignCopy(toc(["Cover", "Chapter I", "Chapter II"], "x"), outline);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});

describe("fragment hrefs", () => {
  const outline = buildOutline([
    { href: "text.xhtml#c1", label: "Chapter 1" },
    { href: "text.xhtml#c2", label: "Chapter 2" },
    { href: "other.xhtml#top", label: "Chapter 3" },
  ]);

  it("identity holds when fragments match exactly", () => {
    const a = alignCopy(
      [
        { href: "text.xhtml#c1", label: "Chapter 1" },
        { href: "text.xhtml#c2", label: "Chapter 2" },
        { href: "other.xhtml#top", label: "Chapter 3" },
      ],
      outline,
    );
    expect(a.identity).toBe(true);
  });

  it("looks up a spine href (no fragment) against fragment TOC hrefs", () => {
    const a = alignCopy(
      [
        { href: "text.xhtml#c1", label: "1" },
        { href: "text.xhtml#c2", label: "2" },
        { href: "other.xhtml#top", label: "3" },
      ],
      outline,
    );
    // two chapters share text.xhtml: the first mapped entry wins
    expect(toOutlinePosition(a, outline, "text.xhtml", 0.3)).toEqual({
      chapterIndex: 0,
      chapterFraction: 0.3,
    });
    expect(toOutlinePosition(a, outline, "other.xhtml", 0.5)).toEqual({
      chapterIndex: 2,
      chapterFraction: 0.5,
    });
    // a fragment on the query is ignored too
    expect(toOutlinePosition(a, outline, "other.xhtml#anything", 0.5).chapterIndex).toBe(2);
  });

  it("fromOutlinePosition returns the TOC href as written", () => {
    const a = alignCopy(
      [{ href: "other.xhtml#top", label: "Chapter 3" }],
      outline,
    );
    expect(fromOutlinePosition(a, outline, { chapterIndex: 2, chapterFraction: 0.4 })).toEqual({
      copyHref: "other.xhtml#top",
      fraction: 0.4,
    });
  });
});

describe("position mapping", () => {
  const outline = buildOutline(toc(["Chapter I", "Chapter II", "Chapter III", "Chapter IV"]));
  // copy: front matter, ch1, ch2, an unmatched appendix-ish entry, ch3 (ch4 missing), back matter
  const copy: TocInput[] = [
    { href: "cover.xhtml", label: "Cover" },
    { href: "c1.xhtml", label: "1" },
    { href: "c2.xhtml", label: "2" },
    { href: "interlude.xhtml", label: "Interlude" },
    { href: "c3.xhtml", label: "3" },
    { href: "notes.xhtml", label: "Notes" },
  ];
  const a = alignCopy(copy, outline);

  it("sanity: alignment as expected", () => {
    expect(a.map).toEqual({ "c1.xhtml": 0, "c2.xhtml": 1, "c3.xhtml": 2 });
    expect(a.confidence).toBe(0.75);
  });

  it("maps a mapped href straight through, keeping the section fraction", () => {
    expect(toOutlinePosition(a, outline, "c2.xhtml", 0.25)).toEqual({
      chapterIndex: 1,
      chapterFraction: 0.25,
    });
  });

  it("an unmapped TOC entry resolves to the preceding mapped chapter at fraction 1", () => {
    expect(toOutlinePosition(a, outline, "interlude.xhtml", 0.5)).toEqual({
      chapterIndex: 1,
      chapterFraction: 1,
    });
    expect(toOutlinePosition(a, outline, "notes.xhtml", 0)).toEqual({
      chapterIndex: 2,
      chapterFraction: 1,
    });
  });

  it("front matter with nothing before it resolves to chapter 0 fraction 0", () => {
    expect(toOutlinePosition(a, outline, "cover.xhtml", 0.8)).toEqual({
      chapterIndex: 0,
      chapterFraction: 0,
    });
  });

  it("a href unknown to the TOC and spine resolves to chapter 0 fraction 0", () => {
    expect(toOutlinePosition(a, outline, "mystery.xhtml", 0.5)).toEqual({
      chapterIndex: 0,
      chapterFraction: 0,
    });
  });

  it("uses the spine to place a TOC-less file after the preceding mapped chapter", () => {
    const spine = ["cover.xhtml", "c1.xhtml", "c2.xhtml", "c2-cont.xhtml", "interlude.xhtml", "c3.xhtml", "notes.xhtml"];
    expect(toOutlinePosition(a, outline, "c2-cont.xhtml", 0.5, spine)).toEqual({
      chapterIndex: 1,
      chapterFraction: 1,
    });
    expect(toOutlinePosition(a, outline, "cover.xhtml", 0.5, spine)).toEqual({
      chapterIndex: 0,
      chapterFraction: 0,
    });
  });

  it("clamps out-of-range and non-finite fractions to [0,1]", () => {
    expect(toOutlinePosition(a, outline, "c1.xhtml", 3).chapterFraction).toBe(1);
    expect(toOutlinePosition(a, outline, "c1.xhtml", -2).chapterFraction).toBe(0);
    expect(toOutlinePosition(a, outline, "c1.xhtml", NaN).chapterFraction).toBe(0);
    expect(
      fromOutlinePosition(a, outline, { chapterIndex: 0, chapterFraction: 9 })?.fraction,
    ).toBe(1);
    expect(
      fromOutlinePosition(a, outline, { chapterIndex: 0, chapterFraction: -9 })?.fraction,
    ).toBe(0);
  });

  it("round-trips for every matched chapter and several fractions", () => {
    for (const href of Object.keys(a.map)) {
      for (const f of [0, 0.1, 0.5, 0.99, 1]) {
        const pos = toOutlinePosition(a, outline, href, f);
        expect(fromOutlinePosition(a, outline, pos)).toEqual({ copyHref: href, fraction: f });
      }
    }
  });

  it("round-trips outline -> copy -> outline for matched chapters", () => {
    for (const idx of [0, 1, 2]) {
      const pos = { chapterIndex: idx, chapterFraction: 0.37 };
      const loc = fromOutlinePosition(a, outline, pos)!;
      expect(toOutlinePosition(a, outline, loc.copyHref, loc.fraction)).toEqual(pos);
    }
  });

  it("an outline chapter missing from the copy resolves to the preceding chapter's end", () => {
    expect(
      fromOutlinePosition(a, outline, { chapterIndex: 3, chapterFraction: 0.5 }),
    ).toEqual({ copyHref: "c3.xhtml", fraction: 1 });
  });

  it("a missing first chapter resolves to the first matched chapter's start", () => {
    const b = alignCopy([{ href: "c2.xhtml", label: "Chapter II" }], outline);
    expect(
      fromOutlinePosition(b, outline, { chapterIndex: 0, chapterFraction: 0.5 }),
    ).toEqual({ copyHref: "c2.xhtml", fraction: 0 });
  });

  it("with no TOC: to-outline gives chapter 0, from-outline gives null", () => {
    const none = alignCopy([], outline);
    expect(toOutlinePosition(none, outline, "c1.xhtml", 0.5)).toEqual({
      chapterIndex: 0,
      chapterFraction: 0,
    });
    expect(fromOutlinePosition(none, outline, { chapterIndex: 1, chapterFraction: 0.5 })).toBeNull();
  });

  it("clamps an out-of-range chapter index", () => {
    expect(
      fromOutlinePosition(a, outline, { chapterIndex: 99, chapterFraction: 0.5 })?.copyHref,
    ).toBe("c3.xhtml");
    expect(
      fromOutlinePosition(a, outline, { chapterIndex: -4, chapterFraction: 0 })?.copyHref,
    ).toBe("c1.xhtml");
  });
});
