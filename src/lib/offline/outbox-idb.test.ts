// The real IndexedDB-backed `OutboxStore`. `outbox.test.ts` drives the replay
// engine through a hand-written in-memory store, which leaves the actual
// `indexedDB` plumbing — and `purgeOutbox` — uncovered. jsdom has no
// IndexedDB, so `fake-indexeddb` stands in (same shim Stage 2's book store
// tests use).

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createIndexedDbStore,
  purgeOutbox,
  type QueuedEntry,
} from "./outbox";

function entry(userId = "user-1"): Omit<QueuedEntry, "id"> {
  return {
    kind: "reading-state",
    key: `${userId}:book-1`,
    payload: {
      userId,
      bookId: "book-1",
      cfi: "epubcfi(/6/2)",
      percent: 0.25,
    },
    ts: Date.now(),
  };
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await purgeOutbox();
  globalThis.indexedDB = new IDBFactory();
});

describe("createIndexedDbStore", () => {
  it("round-trips a queued entry", async () => {
    const store = createIndexedDbStore();
    const id = await store.enqueue(entry());

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);
    expect((all[0].payload as { userId: string }).userId).toBe("user-1");
  });

  it("removes an entry by id", async () => {
    const store = createIndexedDbStore();
    const id = await store.enqueue(entry());
    await store.discard(id);

    expect(await store.list()).toEqual([]);
  });

  it("lists entries in the order they were queued", async () => {
    const store = createIndexedDbStore();
    await store.enqueue(entry("a"));
    await store.enqueue(entry("b"));
    await store.enqueue(entry("c"));

    expect(
      (await store.list()).map((e) => (e.payload as { userId: string }).userId),
    ).toEqual(["a", "b", "c"]);
  });

  it("degrades to a no-op when IndexedDB is absent (SSR-like)", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error - simulating an environment with no IndexedDB at all.
    delete globalThis.indexedDB;

    try {
      const store = createIndexedDbStore();
      await expect(store.enqueue(entry())).resolves.toBeTypeOf("string");
      await expect(store.list()).resolves.toEqual([]);
      await expect(store.discard("nope")).resolves.toBeUndefined();
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it("opens the database once and reuses the handle across operations", async () => {
    const openSpy = vi.spyOn(globalThis.indexedDB, "open");
    const store = createIndexedDbStore();

    await store.enqueue(entry());
    await store.list();
    await store.enqueue(entry());
    await store.list();

    // One handle for the page, not one per operation: a live handle blocks a
    // later `DB_VERSION` upgrade with `onblocked`.
    expect(openSpy).toHaveBeenCalledTimes(1);
    openSpy.mockRestore();
  });
});

describe("purgeOutbox", () => {
  it("drops every queued write", async () => {
    const store = createIndexedDbStore();
    await store.enqueue(entry("a"));
    await store.enqueue(entry("b"));
    expect(await store.list()).toHaveLength(2);

    await purgeOutbox();

    expect(await store.list()).toEqual([]);
  });

  it("leaves the store usable afterwards", async () => {
    const store = createIndexedDbStore();
    await store.enqueue(entry());
    await purgeOutbox();

    await store.enqueue(entry("after-purge"));
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect((all[0].payload as { userId: string }).userId).toBe("after-purge");
  });

  it("never throws when storage is unavailable", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error - simulating an environment with no IndexedDB at all.
    delete globalThis.indexedDB;

    try {
      await expect(purgeOutbox()).resolves.toBeUndefined();
    } finally {
      globalThis.indexedDB = original;
    }
  });
});
