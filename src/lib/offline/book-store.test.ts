// Stage 2 of offline reading — book bytes in IndexedDB. jsdom has no
// IndexedDB (unlike localStorage), so `fake-indexeddb` stands in for it; see
// its README's "Wiping/resetting the indexedDB for a fresh state" for the
// `IDBFactory` reset pattern used in `beforeEach` below.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listCachedBooks,
  purgeCachedBooks,
  readCachedBook,
  updateCachedBookProgress,
  writeCachedBook,
} from "./book-store";

function bytesOf(n: number): ArrayBuffer {
  const buf = new ArrayBuffer(n);
  new Uint8Array(buf).fill(7);
  return buf;
}

/**
 * `fake-indexeddb`'s structured clone hands back an `ArrayBuffer` from a
 * different realm than the test's global — same shape, same `constructor.name`,
 * but `instanceof ArrayBuffer` is false (a jsdom/Node cross-realm quirk, not a
 * behaviour a real single-realm browser would show). Assert on byte length and
 * content instead of `instanceof`.
 */
function expectHit(actual: unknown, byteLength: number): void {
  expect(actual).toBeDefined();
  expect((actual as ArrayBuffer).byteLength).toBe(byteLength);
}

/** Directly overwrite the `meta.totalBytes` row — used to simulate accounting
 * drift for the eviction backstop test, something normal writes can't produce. */
async function seedMetaTotal(totalBytes: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("leaf-books", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("books")) {
        const store = db.createObjectStore("books", { keyPath: "bookId" });
        store.createIndex("by-lastOpenedAt", "lastOpenedAt");
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta");
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("meta", "readwrite");
      tx.objectStore("meta").put({ totalBytes }, "summary");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

function mockEstimate(quota: number) {
  vi.stubGlobal("navigator", {
    ...navigator,
    storage: {
      estimate: vi.fn(async () => ({ quota, usage: 0 })),
      persist: vi.fn(async () => true),
    },
  });
}

beforeEach(() => {
  // Fresh, empty database per test.
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
    new IDBFactory();
  // Generous default quota so ordinary tests aren't fighting the budget.
  mockEstimate(1024 * 1024 * 1024); // 1GB quota -> 300MB cap (budget ceiling)
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("book-store", () => {
  it("round-trips a book's bytes and metadata", async () => {
    const bytes = bytesOf(1024);
    await writeCachedBook("book-1", bytes, { title: "Dracula", author: "Bram Stoker" });

    const read = await readCachedBook("book-1");
    expectHit(read, 1024);
    expect(new Uint8Array(read as ArrayBuffer)).toEqual(new Uint8Array(bytes));
  });

  it("misses quietly for a book never cached", async () => {
    expect(await readCachedBook("nope")).toBeUndefined();
  });

  it("returns a copy on read, not the stored buffer — the engine can't corrupt the cache", async () => {
    const bytes = bytesOf(16);
    await writeCachedBook("book-1", bytes, { title: "T", author: "A" });

    const first = (await readCachedBook("book-1")) as ArrayBuffer;
    new Uint8Array(first).fill(99); // simulate the engine mutating its copy

    const second = (await readCachedBook("book-1")) as ArrayBuffer;
    expect(new Uint8Array(second).every((b) => b === 7)).toBe(true);
  });

  it("does not let a later mutation of the caller's buffer reach the cache", async () => {
    const bytes = bytesOf(16);
    await writeCachedBook("book-1", bytes, { title: "T", author: "A" });

    new Uint8Array(bytes).fill(42); // caller mutates its own buffer after handing it off

    const read = (await readCachedBook("book-1")) as ArrayBuffer;
    expect(new Uint8Array(read).every((b) => b === 7)).toBe(true);
  });

  it("lists cached books with the metadata an offline shelf needs", async () => {
    await writeCachedBook("book-1", bytesOf(10), {
      title: "Dracula",
      author: "Bram Stoker",
      percent: 0.42,
    });
    await writeCachedBook("book-2", bytesOf(10), {
      title: "Frankenstein",
      author: "Mary Shelley",
    });

    const list = await listCachedBooks();
    expect(list).toHaveLength(2);
    expect(list).toEqual(
      expect.arrayContaining([
        { bookId: "book-1", title: "Dracula", author: "Bram Stoker", percent: 0.42 },
        { bookId: "book-2", title: "Frankenstein", author: "Mary Shelley", percent: undefined },
      ]),
    );
  });

  it("purges everything (sign-out) so a second user never reaches the first user's books", async () => {
    await writeCachedBook("book-1", bytesOf(10), { title: "T", author: "A" });
    await writeCachedBook("book-2", bytesOf(10), { title: "T2", author: "A2" });

    await purgeCachedBooks();

    expect(await listCachedBooks()).toEqual([]);
    expect(await readCachedBook("book-1")).toBeUndefined();
    expect(await readCachedBook("book-2")).toBeUndefined();
  });

  it("does nothing without a book id", async () => {
    await writeCachedBook("", bytesOf(10), { title: "T", author: "A" });
    expect(await listCachedBooks()).toEqual([]);
    expect(await readCachedBook("")).toBeUndefined();
  });

  describe("updateCachedBookProgress", () => {
    it("updates the percent of an already-cached book without touching its bytes", async () => {
      await writeCachedBook("book-1", bytesOf(1024), {
        title: "Dracula",
        author: "Bram Stoker",
        percent: 0.1,
      });

      await updateCachedBookProgress("book-1", 0.73);

      const list = await listCachedBooks();
      expect(list).toEqual([
        { bookId: "book-1", title: "Dracula", author: "Bram Stoker", percent: 0.73 },
      ]);
      // Bytes and identity are untouched — only `percent` moved.
      expectHit(await readCachedBook("book-1"), 1024);
    });

    it("does nothing when the book isn't cached yet", async () => {
      await expect(
        updateCachedBookProgress("never-cached", 0.5),
      ).resolves.toBeUndefined();
      expect(await listCachedBooks()).toEqual([]);
    });

    it("does nothing without a book id", async () => {
      await expect(
        updateCachedBookProgress("", 0.5),
      ).resolves.toBeUndefined();
    });

    it("degrades quietly, never throwing, when indexedDB is unavailable", async () => {
      const original = (globalThis as unknown as { indexedDB?: IDBFactory })
        .indexedDB;
      // @ts-expect-error - simulating an environment with no IndexedDB at all.
      delete globalThis.indexedDB;

      try {
        await expect(
          updateCachedBookProgress("book-1", 0.5),
        ).resolves.toBeUndefined();
      } finally {
        (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
          original as IDBFactory;
      }
    });
  });

  describe("eviction", () => {
    it("evicts least-recently-opened first when the budget is exceeded", async () => {
      mockEstimate(2000); // budget = min(300MB, 1000) = 1000 bytes

      await writeCachedBook("old", bytesOf(400), { title: "Old", author: "A" });
      // Open "old" again so its lastOpenedAt is bumped forward, then write a
      // second, less-recently-opened book so ordering isn't just insertion order.
      await new Promise((r) => setTimeout(r, 5));
      await writeCachedBook("middle", bytesOf(400), { title: "Middle", author: "A" });
      await new Promise((r) => setTimeout(r, 5));
      await readCachedBook("old"); // bump "old" to most-recently-opened

      // Adding a third book now exceeds the 1000-byte budget (400+400+400=1200)
      // and must evict "middle" (least-recently-opened), not "old".
      await new Promise((r) => setTimeout(r, 5));
      await writeCachedBook("new", bytesOf(400), { title: "New", author: "A" });

      const ids = (await listCachedBooks()).map((b) => b.bookId).sort();
      expect(ids).toEqual(["new", "old"].sort());
      expect(await readCachedBook("middle")).toBeUndefined();
    });

    it("never evicts the book currently being written, even if it is the oldest", async () => {
      mockEstimate(2000); // budget = 1000 bytes

      await writeCachedBook("a", bytesOf(400), { title: "A", author: "A" });
      await new Promise((r) => setTimeout(r, 5));
      await writeCachedBook("b", bytesOf(400), { title: "B", author: "A" });

      // Re-writing "a" (e.g. an updated percent) with more bytes would normally
      // evict the least-recently-opened entry to make room — but "a" IS that
      // entry, and must survive its own write.
      await writeCachedBook("a", bytesOf(700), { title: "A", author: "A", percent: 0.9 });

      const a = await readCachedBook("a");
      expectHit(a, 700);
    });

    it("skips caching entirely when the incoming book alone exceeds the budget", async () => {
      mockEstimate(1000); // budget = 500 bytes

      await writeCachedBook("huge", bytesOf(600), { title: "Huge", author: "A" });

      expect(await readCachedBook("huge")).toBeUndefined();
      expect(await listCachedBooks()).toEqual([]);
    });

    it("gives up silently when eviction can't make room, without throwing", async () => {
      mockEstimate(2000); // budget = 1000 bytes

      // One small, genuinely evictable entry...
      await writeCachedBook("small", bytesOf(10), { title: "S", author: "A" });
      // ...but the running total has drifted far above reality (an accounting
      // bug, simulated directly) so that evicting every other entry still
      // isn't enough. This is the backstop path: normal arithmetic can always
      // make room by evicting everything else, so exercising the "still
      // doesn't fit" branch means forcing the drift by hand.
      await seedMetaTotal(5000);

      await expect(
        writeCachedBook("new", bytesOf(500), { title: "N", author: "A" }),
      ).resolves.toBeUndefined();

      expect(await readCachedBook("new")).toBeUndefined();
    });
  });

  describe("budget fallback", () => {
    it("falls back to a flat budget when estimate() is unavailable", async () => {
      vi.stubGlobal("navigator", { ...navigator, storage: undefined });

      // 50MB comfortably fits the 100MB fallback budget.
      const bytes = bytesOf(50 * 1024 * 1024);
      await writeCachedBook("book-1", bytes, { title: "T", author: "A" });

      expectHit(await readCachedBook("book-1"), 50 * 1024 * 1024);
    });

    it("falls back to a flat budget when estimate() throws", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        storage: {
          estimate: vi.fn(async () => {
            throw new Error("nope");
          }),
        },
      });

      const bytes = bytesOf(50 * 1024 * 1024);
      await writeCachedBook("book-1", bytes, { title: "T", author: "A" });

      expectHit(await readCachedBook("book-1"), 50 * 1024 * 1024);
    });

    it("caps the budget at 300MB even when quota is huge", async () => {
      mockEstimate(10 * 1024 * 1024 * 1024); // 10GB quota -> would be 5GB uncapped

      // A 350MB book exceeds the 300MB cap and must be skipped.
      const bytes = bytesOf(350 * 1024 * 1024);
      await writeCachedBook("book-1", bytes, { title: "T", author: "A" });

      expect(await readCachedBook("book-1")).toBeUndefined();
    });
  });

  describe("connection handling", () => {
    it("opens the database once and reuses the handle across calls", async () => {
      const factory = globalThis.indexedDB;
      const openSpy = vi.spyOn(factory, "open");

      await writeCachedBook("book-1", bytesOf(10), { title: "T", author: "A" });
      await readCachedBook("book-1");
      await listCachedBooks();
      await readCachedBook("book-1");

      // One handle for the page, not one per call: a live handle blocks a
      // later `DB_VERSION` upgrade with `onblocked`, so leaking one per read
      // would make a future migration unrunnable.
      expect(openSpy).toHaveBeenCalledTimes(1);
      openSpy.mockRestore();
    });
  });

  describe("unsupported / blocked storage", () => {
    it("always misses when indexedDB is undefined (SSR-like)", async () => {
      const original = (globalThis as unknown as { indexedDB?: IDBFactory })
        .indexedDB;
      // @ts-expect-error - simulating an environment with no IndexedDB at all.
      delete globalThis.indexedDB;

      try {
        expect(
          await writeCachedBook("book-1", bytesOf(10), { title: "T", author: "A" }),
        ).toBeUndefined();
        expect(await readCachedBook("book-1")).toBeUndefined();
        expect(await listCachedBooks()).toEqual([]);
        await expect(purgeCachedBooks()).resolves.toBeUndefined();
      } finally {
        (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
          original as IDBFactory;
      }
    });

    it("degrades to a miss, never throwing, when opening the database throws", async () => {
      vi.stubGlobal("indexedDB", {
        open: () => {
          throw new Error("blocked by browser settings");
        },
      });

      await expect(
        writeCachedBook("book-1", bytesOf(10), { title: "T", author: "A" }),
      ).resolves.toBeUndefined();
      await expect(readCachedBook("book-1")).resolves.toBeUndefined();
      await expect(listCachedBooks()).resolves.toEqual([]);
    });
  });
});
