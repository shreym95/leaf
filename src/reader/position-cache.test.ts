// Local reading-position cache — offline defect: reader reopens at page 0
// with the document cached but no server reachable to ask for the position.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCachedPosition, writeCachedPosition } from "./position-cache";

describe("position cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips a position for a book", () => {
    writeCachedPosition("book-1", {
      cfi: "epubcfi(/6/14!/4/2/1:0)",
      percent: 0.42,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    expect(readCachedPosition("book-1")).toEqual({
      cfi: "epubcfi(/6/14!/4/2/1:0)",
      percent: 0.42,
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });

  it("keys by book, so one book's position is never served for another", () => {
    writeCachedPosition("book-1", {
      cfi: "epubcfi(/6/14!/4/2/1:0)",
      percent: 0.42,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    expect(readCachedPosition("book-2")).toBeUndefined();
  });

  it("a later write for the same book overwrites the earlier one", () => {
    writeCachedPosition("book-1", {
      cfi: "epubcfi(A)",
      percent: 0.1,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    writeCachedPosition("book-1", {
      cfi: "epubcfi(B)",
      percent: 0.5,
      updatedAt: "2026-01-02T00:00:00Z",
    });

    expect(readCachedPosition("book-1")).toEqual({
      cfi: "epubcfi(B)",
      percent: 0.5,
      updatedAt: "2026-01-02T00:00:00Z",
    });
  });

  it("misses quietly on a malformed entry", () => {
    window.localStorage.setItem("leaf:position:v1:book-1", "{not json");
    expect(readCachedPosition("book-1")).toBeUndefined();
  });

  it("misses quietly on an entry missing a required field", () => {
    window.localStorage.setItem(
      "leaf:position:v1:book-1",
      JSON.stringify({ cfi: "epubcfi(A)" }),
    );
    expect(readCachedPosition("book-1")).toBeUndefined();
  });

  it("misses quietly when storage throws on read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => readCachedPosition("book-1")).not.toThrow();
    expect(readCachedPosition("book-1")).toBeUndefined();
  });

  it("degrades silently when storage throws on write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() =>
      writeCachedPosition("book-1", {
        cfi: "epubcfi(A)",
        percent: 0.1,
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    ).not.toThrow();
  });

  it("does nothing for an empty bookId or a missing cfi", () => {
    writeCachedPosition("", { cfi: "epubcfi(A)", percent: 0.1, updatedAt: "2026-01-01T00:00:00Z" });
    writeCachedPosition("book-1", { cfi: "", percent: 0.1, updatedAt: "2026-01-01T00:00:00Z" });
    expect(readCachedPosition("book-1")).toBeUndefined();
  });
});
