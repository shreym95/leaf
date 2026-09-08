// `bookmarks` db wrappers (0005) — assert the query shape: table, owner + book
// filters, insert payload (label / percent denormalised, defaulted to null),
// delete scoping. A hand-rolled fake Supabase client records the calls.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listBookmarks, createBookmark, deleteBookmark } from "./bookmarks";
import type { Bookmark } from "@/lib/types";

const ROW: Bookmark = {
  id: "bm-1",
  book_id: "book1",
  user_id: "u1",
  cfi: "epubcfi(/6/14!/4/2/1:0)",
  label: "Chapter 1",
  percent: 0.25,
  created_at: "2026-09-09T00:00:00Z",
};

function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: Record<string, unknown> = {};
  const rec = (key: string, args: unknown[]) => {
    if (key === "eq") {
      calls.eq = [...((calls.eq as unknown[]) ?? []), args];
    } else {
      calls[key] = args;
    }
  };
  const builder = {
    select: (...a: unknown[]) => (rec("select", a), builder),
    insert: (...a: unknown[]) => (rec("insert", a), builder),
    delete: (...a: unknown[]) => (rec("delete", a), builder),
    eq: (...a: unknown[]) => (rec("eq", a), builder),
    order: (...a: unknown[]) => (rec("order", a), Promise.resolve(result)),
    single: () => Promise.resolve(result),
    then: (fn: (r: typeof result) => unknown) => Promise.resolve(fn(result)),
  };
  const from = vi.fn((table: string) => ((calls.from = table), builder));
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("listBookmarks", () => {
  it("reads the bookmarks table scoped to user + book, oldest first", async () => {
    const { client, calls } = fakeClient({ data: [ROW], error: null });
    const out = await listBookmarks("u1", "book1", client);

    expect(calls.from).toBe("bookmarks");
    expect(calls.eq).toEqual([
      ["user_id", "u1"],
      ["book_id", "book1"],
    ]);
    expect(calls.order).toEqual(["created_at", { ascending: true }]);
    expect(out).toEqual([ROW]);
  });

  it("returns [] when the table is empty", async () => {
    const { client } = fakeClient({ data: null, error: null });
    await expect(listBookmarks("u1", "book1", client)).resolves.toEqual([]);
  });

  it("throws on a db error", async () => {
    const { client } = fakeClient({ data: null, error: new Error("nope") });
    await expect(listBookmarks("u1", "book1", client)).rejects.toThrow("nope");
  });
});

describe("createBookmark", () => {
  it("inserts the owner, book, cfi and denormalised label / percent", async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null });
    const rec = await createBookmark(
      "u1",
      { bookId: "book1", cfi: ROW.cfi, label: "Chapter 1", percent: 0.25 },
      client,
    );

    expect(calls.from).toBe("bookmarks");
    expect(calls.insert).toEqual([
      {
        user_id: "u1",
        book_id: "book1",
        cfi: ROW.cfi,
        label: "Chapter 1",
        percent: 0.25,
      },
    ]);
    expect(rec).toEqual(ROW);
  });

  it("defaults label and percent to null when omitted", async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null });
    await createBookmark("u1", { bookId: "book1", cfi: ROW.cfi }, client);

    expect(calls.insert).toEqual([
      { user_id: "u1", book_id: "book1", cfi: ROW.cfi, label: null, percent: null },
    ]);
  });
});

describe("deleteBookmark", () => {
  it("deletes by id, scoped to the owner", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await deleteBookmark("u1", "bm-1", client);

    expect(calls.from).toBe("bookmarks");
    expect(calls.delete).toEqual([]);
    expect(calls.eq).toEqual([
      ["user_id", "u1"],
      ["id", "bm-1"],
    ]);
  });

  it("throws on a db error", async () => {
    const { client } = fakeClient({ data: null, error: new Error("denied") });
    await expect(deleteBookmark("u1", "bm-1", client)).rejects.toThrow("denied");
  });

  it("requires an explicit client", async () => {
    await expect(deleteBookmark("u1", "bm-1")).rejects.toThrow(
      /explicit Supabase client/,
    );
  });
});
