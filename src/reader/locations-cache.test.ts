// DEFECTS.md D7 — progress reads 0% for seconds after opening a book.
//
// Two halves to the fix, tested here: the locations table is cached per book so
// the second open never regenerates it, and until it exists the reader reports
// a spine estimate rather than a flat 0.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCachedLocations, writeCachedLocations } from "./locations-cache";
import { estimateProgress } from "./engine";

const CHARS = 1200;
const TABLE = JSON.stringify(["epubcfi(/6/2!/4/2/1:0)", "epubcfi(/6/4!/4/2/1:0)"]);

describe("locations cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips a table for a book", () => {
    writeCachedLocations("book-1", CHARS, TABLE);
    expect(readCachedLocations("book-1", CHARS)).toBe(TABLE);
  });

  it("keys by book, so one book's table is never served for another", () => {
    writeCachedLocations("book-1", CHARS, TABLE);
    expect(readCachedLocations("book-2", CHARS)).toBeUndefined();
  });

  it("keys by granularity, so changing `chars` invalidates rather than misreads", () => {
    writeCachedLocations("book-1", CHARS, TABLE);
    expect(readCachedLocations("book-1", 600)).toBeUndefined();
  });

  it("ignores a truncated entry", () => {
    // A half-written value parses as nothing useful and would leave
    // `locations.total` at -1, making every percentage NaN. Better to miss.
    window.localStorage.setItem(
      `leaf:locations:v1:book-1:${CHARS}`,
      TABLE.slice(0, 20),
    );
    expect(readCachedLocations("book-1", CHARS)).toBeUndefined();
  });

  it("misses quietly when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => readCachedLocations("book-1", CHARS)).not.toThrow();
    expect(readCachedLocations("book-1", CHARS)).toBeUndefined();
  });

  it("evicts other books and retries when the quota is hit", () => {
    writeCachedLocations("old-book", CHARS, TABLE);

    const real = Storage.prototype.setItem;
    let firstWrite = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k: string,
      v: string,
    ) {
      if (firstWrite) {
        firstWrite = false;
        throw new DOMException("quota", "QuotaExceededError");
      }
      real.call(this, k, v);
    });

    writeCachedLocations("new-book", CHARS, TABLE);

    // The book being read now is the one that survives.
    expect(readCachedLocations("new-book", CHARS)).toBe(TABLE);
    expect(readCachedLocations("old-book", CHARS)).toBeUndefined();
  });

  it("gives up silently when storage is unusable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => writeCachedLocations("book-1", CHARS, TABLE)).not.toThrow();
  });

  it("does nothing without a book id", () => {
    writeCachedLocations("", CHARS, TABLE);
    expect(window.localStorage.length).toBe(0);
    expect(readCachedLocations("", CHARS)).toBeUndefined();
  });
});

describe("estimateProgress", () => {
  it("is 0 at the very start of the book", () => {
    expect(estimateProgress(0, 40, 1, 10)).toBe(0);
  });

  it("advances by section even with no page information", () => {
    // The symptom D7 is about: on chapter 20 of 40 the bar must not read 0%.
    expect(estimateProgress(20, 40, undefined, undefined)).toBeCloseTo(0.5, 5);
  });

  it("interpolates within a section", () => {
    // Halfway through section 0 of 4 → an eighth of the book.
    expect(estimateProgress(0, 4, 5, 9)).toBeCloseTo(0.125, 5);
  });

  it("treats a single-page section as its start", () => {
    // page 1 of 1 has no interior to interpolate — dividing by (total - 1)
    // would be a division by zero.
    expect(estimateProgress(2, 4, 1, 1)).toBeCloseTo(0.5, 5);
  });

  it("never leaves 0..1, whatever epub.js reports", () => {
    expect(estimateProgress(99, 4, 3, 3)).toBe(1);
    expect(estimateProgress(-3, 4, 1, 2)).toBe(0);
    expect(estimateProgress(1, 4, 12, 3)).toBeCloseTo(0.5, 5);
  });

  it("declines to guess when the spine length is unknown", () => {
    // Then the caller keeps the old behaviour and reports 0.
    expect(estimateProgress(3, 0, 1, 10)).toBeUndefined();
    expect(estimateProgress(undefined, 40, 1, 10)).toBeUndefined();
  });
});
