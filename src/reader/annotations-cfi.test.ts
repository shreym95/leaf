// CFI ordering and overlap through epub.js `EpubCFI.compare`. Pure: no rendition,
// no persistence, no epub.js mock. Complements `annotations.test.ts`.

import { describe, expect, it } from "vitest";
import { cfisOverlap, compareCfi } from "./annotations";

describe("compareCfi with epub.js CFI compare", () => {
  it("ignores [id] assertions on steps", () => {
    expect(compareCfi("epubcfi(/6/4!/4[intro]/2/1:0)", "epubcfi(/6/4!/4/2/1:0)")).toBe(0);
    expect(compareCfi("epubcfi(/6/4!/4[a]/2/1:5)", "epubcfi(/6/4!/4[b]/2/1:9)")).toBeLessThan(0);
  });

  it("orders character offsets numerically, not as text", () => {
    // Plain string order would put ":10" before ":9".
    expect(compareCfi("epubcfi(/6/4!/4/2/1:9)", "epubcfi(/6/4!/4/2/1:10)")).toBeLessThan(0);
    expect(compareCfi("epubcfi(/6/4!/4/2/1:100)", "epubcfi(/6/4!/4/2/1:20)")).toBeGreaterThan(0);
  });

  it("orders nested steps: an element precedes its descendants", () => {
    expect(compareCfi("epubcfi(/6/4!/4/2)", "epubcfi(/6/4!/4/2/1:0)")).toBeLessThan(0);
    expect(compareCfi("epubcfi(/6/4!/4/2/3:0)", "epubcfi(/6/4!/4/2/1:99)")).toBeGreaterThan(0);
    expect(compareCfi("epubcfi(/6/4!/4/2/1:0)", "epubcfi(/6/4!/4/10/1:0)")).toBeLessThan(0);
  });

  it("orders by spine position before the path", () => {
    expect(compareCfi("epubcfi(/6/4!/4/2/1:500)", "epubcfi(/6/8!/4/2/1:0)")).toBeLessThan(0);
  });

  it("orders a point that the old parser flattened wrongly", () => {
    // An offset on element step /2 (non-standard: epub.js puts offsets on text
    // steps). The old flattening read ":50" as if it were a child step after /2,
    // so it placed this point after "/2/1:0". epub.js puts it before its child.
    expect(compareCfi("epubcfi(/6/4!/4/2:50)", "epubcfi(/6/4!/4/2/1:0)")).toBeLessThan(0);
  });

  it("gives a range the order of its start, and ties at equal starts", () => {
    const range = "epubcfi(/6/4!/4/2,/1:10,/1:20)";
    expect(compareCfi(range, "epubcfi(/6/4!/4/2/1:10)")).toBe(0);
    expect(compareCfi(range, "epubcfi(/6/4!/4/2/1:5)")).toBeGreaterThan(0);
    expect(compareCfi("epubcfi(/6/4!/4/2/1:5)", range)).toBeLessThan(0);
  });

  it("falls back to string order when a CFI cannot be parsed", () => {
    expect(compareCfi("nope", "epubcfi(/6/4!/4/2/1:0)")).toBeGreaterThan(0);
    expect(compareCfi("epubcfi(/6/4!/4/2/1:0)", "nope")).toBeLessThan(0);
    expect(compareCfi("nope", "nope")).toBe(0);
  });
});

describe("cfisOverlap with epub.js CFI compare", () => {
  it("counts ranges that touch at one position as overlapping (inclusive ends)", () => {
    expect(
      cfisOverlap("epubcfi(/6/4!/4[a]/2,/1:0,/1:10)", "epubcfi(/6/4!/4/2,/1:10,/1:20)"),
    ).toBe(true);
  });

  it("detects a point inside a range, and a range inside a range", () => {
    const range = "epubcfi(/6/4!/4/2,/1:10,/1:20)";
    expect(cfisOverlap(range, "epubcfi(/6/4!/4/2/1:15)")).toBe(true);
    expect(cfisOverlap(range, "epubcfi(/6/4!/4/2,/1:0,/1:100)")).toBe(true);
  });

  it("separates ranges that end before the other starts, including across chapters", () => {
    expect(cfisOverlap("epubcfi(/6/4!/4/2,/1:0,/1:9)", "epubcfi(/6/4!/4/2,/1:10,/1:20)")).toBe(false);
    expect(cfisOverlap("epubcfi(/6/4!/4/2,/1:0,/1:9)", "epubcfi(/6/8!/4/2,/1:0,/1:9)")).toBe(false);
  });

  it("matches only an identical string when a CFI cannot be parsed", () => {
    expect(cfisOverlap("nope", "nope")).toBe(true);
    expect(cfisOverlap("nope", "epubcfi(/6/4!/4/2/1:0)")).toBe(false);
  });
});
