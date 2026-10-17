// The offline cache of personal annotations (N1e): per-book IndexedDB storage,
// the online / offline / network-failure choice in `listAnnotationsWithCache`,
// queued edits applied over the cached list, and the sign-out purge. IndexedDB
// comes from fake-indexeddb; the Supabase client is a hand-rolled fake that
// records the query and answers with a fixed result or a network failure.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({ marker: "browser-client" })),
}));

import {
  listAnnotationsWithCache,
  purgeAnnotationCache,
  readCachedAnnotations,
  writeCachedAnnotations,
} from "./annotations";
import {
  createIndexedDbStore,
  enqueueAnnotationCreate,
  enqueueAnnotationDelete,
  enqueueAnnotationNote,
  purgeOutbox,
} from "@/lib/offline/outbox";
import type { Annotation } from "@/lib/types";

const ID_A = "3f2c9d1e-8a4b-4c6d-9e0f-1a2b3c4d5e6f";
const ID_B = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
const ID_C = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";

function row(over: Partial<Annotation> & { id: string }): Annotation {
  return {
    user_id: "u1",
    book_id: "book1",
    kind: "page",
    cfi: "epubcfi(/6/14!/4/2/1:0)",
    quote: null,
    note: null,
    label: "Chapter 1",
    percent: 0.25,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

const ROW_A = row({ id: ID_A, note: "first note" });
const ROW_B = row({
  id: ID_B,
  kind: "range",
  cfi: "epubcfi(/6/14!/4/2,/1:0,/1:9)",
  quote: "a quoted line",
  created_at: "2026-10-02T00:00:00.000Z",
});

/**
 * Fake Supabase client for `listAnnotations`: `from().select().eq().order()`
 * resolves to `result`, or rejects with `failure` when one is given.
 */
function fakeClient(opts: { rows?: Annotation[]; failure?: unknown } = {}) {
  const order = vi.fn(() =>
    opts.failure !== undefined
      ? Promise.reject(opts.failure)
      : Promise.resolve({ data: opts.rows ?? [], error: null }),
  );
  const builder = {
    select: () => builder,
    eq: () => builder,
    order,
  };
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, from, order };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => value });
}

const store = createIndexedDbStore();

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await purgeOutbox();
  globalThis.indexedDB = new IDBFactory();
  setOnline(true);
});

afterEach(() => {
  setOnline(true);
});

describe("writeCachedAnnotations / readCachedAnnotations", () => {
  it("round-trips one user's rows for one book", async () => {
    await writeCachedAnnotations("u1", "book1", [ROW_A, ROW_B]);

    expect(await readCachedAnnotations("u1", "book1")).toEqual([ROW_A, ROW_B]);
  });

  it("returns nothing for another user or another book", async () => {
    await writeCachedAnnotations("u1", "book1", [ROW_A]);

    expect(await readCachedAnnotations("u2", "book1")).toEqual([]);
    expect(await readCachedAnnotations("u1", "book2")).toEqual([]);
  });

  it("replaces the cached rows on each write", async () => {
    await writeCachedAnnotations("u1", "book1", [ROW_A, ROW_B]);
    await writeCachedAnnotations("u1", "book1", [ROW_B]);

    expect(await readCachedAnnotations("u1", "book1")).toEqual([ROW_B]);
  });

  it("never caches a row the user does not own or that is in another book", async () => {
    const foreign = row({ id: ID_C, user_id: "someone-else" });
    const otherBook = row({ id: ID_C, book_id: "book2" });
    await writeCachedAnnotations("u1", "book1", [ROW_A, foreign, otherBook]);

    expect(await readCachedAnnotations("u1", "book1")).toEqual([ROW_A]);
  });
});

describe("listAnnotationsWithCache", () => {
  it("online: returns the server list and refreshes the cache", async () => {
    const { client, from } = fakeClient({ rows: [ROW_A, ROW_B] });

    const rows = await listAnnotationsWithCache("u1", "book1", client);

    expect(from).toHaveBeenCalledWith("annotations");
    expect(rows).toEqual([ROW_A, ROW_B]);
    expect(await readCachedAnnotations("u1", "book1")).toEqual([ROW_A, ROW_B]);
  });

  it("offline: returns the cached list and never calls the server", async () => {
    await writeCachedAnnotations("u1", "book1", [ROW_A]);
    setOnline(false);
    const { client, from } = fakeClient({ rows: [ROW_B] });

    expect(await listAnnotationsWithCache("u1", "book1", client)).toEqual([ROW_A]);
    expect(from).not.toHaveBeenCalled();
  });

  it("on a network failure: falls back to the cached list", async () => {
    await writeCachedAnnotations("u1", "book1", [ROW_A]);
    const { client } = fakeClient({ failure: new TypeError("Failed to fetch") });

    expect(await listAnnotationsWithCache("u1", "book1", client)).toEqual([ROW_A]);
  });

  it("on a server rejection (not a network failure): rethrows, the cache is not used", async () => {
    await writeCachedAnnotations("u1", "book1", [ROW_A]);
    const { client } = fakeClient({ failure: { code: "42501", message: "denied" } });

    await expect(listAnnotationsWithCache("u1", "book1", client)).rejects.toEqual({
      code: "42501",
      message: "denied",
    });
  });

  it("with no client, throws the explicit-client error", async () => {
    await expect(listAnnotationsWithCache("u1", "book1")).rejects.toThrow(
      /explicit Supabase client/,
    );
  });

  it("applies queued offline edits over the cached list", async () => {
    await writeCachedAnnotations("u1", "book1", [ROW_A, ROW_B]);
    setOnline(false);
    await enqueueAnnotationNote("u1", ID_A, "edited offline");
    await enqueueAnnotationDelete("u1", ID_B);
    await enqueueAnnotationCreate("u1", {
      id: ID_C,
      bookId: "book1",
      kind: "page",
      cfi: "epubcfi(/6/30!/4/2)",
      label: "Chapter 3",
      percent: 0.6,
    });

    const rows = await listAnnotationsWithCache("u1", "book1", {} as SupabaseClient);

    expect(rows.map((r) => r.id)).toEqual([ID_A, ID_C]);
    expect(rows[0].note).toBe("edited offline");
    expect(rows[1]).toMatchObject({ id: ID_C, user_id: "u1", book_id: "book1", kind: "page", note: null });
  });

  it("a queued create for another book is not shown in this book", async () => {
    setOnline(false);
    await enqueueAnnotationCreate("u1", {
      id: ID_C,
      bookId: "book2",
      kind: "page",
      cfi: "epubcfi(/6/30!/4/2)",
    });

    expect(await listAnnotationsWithCache("u1", "book1", {} as SupabaseClient)).toEqual([]);
  });

  it("a queued create for another user is not shown", async () => {
    setOnline(false);
    await enqueueAnnotationCreate("u2", {
      id: ID_C,
      bookId: "book1",
      kind: "page",
      cfi: "epubcfi(/6/30!/4/2)",
    });

    expect(await listAnnotationsWithCache("u1", "book1", {} as SupabaseClient)).toEqual([]);
  });

  it("a queued create that the server already returned is not listed twice", async () => {
    await enqueueAnnotationCreate("u1", {
      id: ID_A,
      bookId: "book1",
      kind: "page",
      cfi: ROW_A.cfi,
    });
    const { client } = fakeClient({ rows: [ROW_A] });

    const rows = await listAnnotationsWithCache("u1", "book1", client);

    expect(rows.map((r) => r.id)).toEqual([ID_A]);
  });

  it("applies a queued legacy highlight-create as a range row", async () => {
    setOnline(false);
    await store.enqueue({
      kind: "highlight-create",
      key: `u1:${ID_C}`,
      payload: {
        userId: "u1",
        localId: ID_C,
        bookId: "book1",
        cfiRange: "epubcfi(/6/30!/4/2,/1:0,/1:9)",
        text: "old highlight",
        color: "copper",
      },
      ts: Date.parse("2026-10-17T10:00:00.000Z"),
    });

    const [only] = await listAnnotationsWithCache("u1", "book1", {} as SupabaseClient);

    expect(only).toMatchObject({
      id: ID_C,
      kind: "range",
      quote: "old highlight",
      created_at: "2026-10-17T10:00:00.000Z",
    });
  });
});

describe("purgeAnnotationCache", () => {
  it("is part of the sign-out purge (purgeOutbox): the cache is empty afterwards", async () => {
    await writeCachedAnnotations("u1", "book1", [ROW_A]);

    await purgeOutbox();

    expect(await readCachedAnnotations("u1", "book1")).toEqual([]);
  });

  it("never throws when IndexedDB is unavailable", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error - simulating an environment with no IndexedDB at all.
    delete globalThis.indexedDB;
    try {
      await expect(purgeAnnotationCache()).resolves.toBeUndefined();
      await expect(readCachedAnnotations("u1", "book1")).resolves.toEqual([]);
      await expect(writeCachedAnnotations("u1", "book1", [ROW_A])).resolves.toBeUndefined();
    } finally {
      globalThis.indexedDB = original;
    }
  });
});
