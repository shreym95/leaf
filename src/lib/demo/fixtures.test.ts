import { describe, expect, it } from "vitest";
import {
  demoListBooks,
  demoCountArchivedBooks,
  demoGetBook,
  demoBookFileUrl,
  DEMO_USER,
} from "./fixtures";

describe("demo fixtures", () => {
  it("gives the shelf a realistic length with varied covers and progress", () => {
    const books = demoListBooks();
    expect(books.length).toBeGreaterThanOrEqual(15);
    // A mix the shelf design needs to handle: real covers, no cover, every
    // progress state.
    expect(books.some((b) => b.coverUrl !== null)).toBe(true);
    expect(books.some((b) => b.coverUrl === null)).toBe(true);
    expect(books.some((b) => b.percent === null)).toBe(true);
    expect(books.some((b) => b.percent === 1)).toBe(true);
    expect(books.some((b) => b.percent !== null && b.percent > 0 && b.percent < 1)).toBe(true);
  });

  it("hides archived books from the default shelf and lists them on request", () => {
    const visible = demoListBooks();
    const hidden = demoListBooks({ archived: true });
    expect(hidden.length).toBe(demoCountArchivedBooks());
    expect(hidden.length).toBeGreaterThan(0);
    expect(visible.every((b) => b.archived_at == null)).toBe(true);
    expect(hidden.every((b) => b.archived_at != null)).toBe(true);
    const visibleIds = new Set(visible.map((b) => b.id));
    expect(hidden.every((b) => !visibleIds.has(b.id))).toBe(true);
  });

  it("orders most-recently-read first, then never-opened by newest added", () => {
    const books = demoListBooks();
    const firstUnopened = books.findIndex((b) => b.lastReadAt === null);
    // every opened book comes before every never-opened one
    expect(books.slice(0, firstUnopened).every((b) => b.lastReadAt !== null)).toBe(true);
    const readDates = books
      .slice(0, firstUnopened)
      .map((b) => b.lastReadAt as string);
    expect([...readDates].sort((a, b) => b.localeCompare(a))).toEqual(readDates);
  });

  it("exposes exactly four openable EPUBs, all served from /bundled/", () => {
    const openable = demoListBooks().filter((b) => b.storage_path);
    expect(openable.map((b) => b.id).sort()).toEqual([
      "chapter-image-heading",
      "frankenstein",
      "time-machine",
      "wizard-of-oz",
    ]);
    // One directory, no exceptions: `public/bundled/` is where an openable demo
    // EPUB lives, whether it is a full Standard Ebooks download or a synthetic
    // fixture. `public/demo/` holds cover images only.
    for (const b of openable) {
      expect(demoBookFileUrl(b.storage_path as string)).toMatch(
        /^\/bundled\/[a-z-]+\.epub$/,
      );
    }
  });

  it("returns a plain Book (no shelf-only fields) from demoGetBook, or null", () => {
    const book = demoGetBook("frankenstein");
    expect(book?.title).toBe("Frankenstein");
    expect(book && "percent" in book).toBe(false);
    expect(book && "coverUrl" in book).toBe(false);
    expect(demoGetBook("does-not-exist")).toBeNull();
  });

  it("can look up a hidden book by id (the reader route still needs it)", () => {
    const hidden = demoListBooks({ archived: true })[0];
    expect(demoGetBook(hidden.id)?.id).toBe(hidden.id);
  });

  it("has a stable demo user identity", () => {
    expect(DEMO_USER.id).toBe("demo-designer");
    expect(DEMO_USER.email).toBe("designer@leaf.local");
  });
});
