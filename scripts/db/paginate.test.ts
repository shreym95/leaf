// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fetchAllRows, listAllObjects, listAuthUserIds } from "./lib/paginate.mjs";
import { createFakeClient } from "./testing/fake-client";

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(5, "0") }));

describe("fetchAllRows", () => {
  it("stops on a short page", async () => {
    const { client, calls } = createFakeClient({ tables: { books: rowsOf(2500) } });
    const rows = await fetchAllRows(client, "books", ["id"]);
    expect(rows).toHaveLength(2500);
    expect(calls.ranges.map((r) => [r.from, r.to])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("stops on an empty page when the total is an exact multiple of the page size", async () => {
    const { client, calls } = createFakeClient({ tables: { books: rowsOf(2000) } });
    expect(await fetchAllRows(client, "books", ["id"])).toHaveLength(2000);
    expect(calls.ranges).toHaveLength(3);
  });

  it("handles an empty table with one request", async () => {
    const { client, calls } = createFakeClient({ tables: {} });
    expect(await fetchAllRows(client, "books", ["id"])).toEqual([]);
    expect(calls.ranges).toHaveLength(1);
  });

  it("orders by every primary-key column", async () => {
    const { client, calls } = createFakeClient({ tables: { reading_state: [] } });
    await fetchAllRows(client, "reading_state", ["book_id", "user_id"]);
    expect(calls.ranges[0].order).toEqual(["book_id", "user_id"]);
  });

  it("returns every row exactly once, in key order", async () => {
    const shuffled = rowsOf(1500).reverse();
    const { client } = createFakeClient({ tables: { books: shuffled } });
    const rows = await fetchAllRows(client, "books", ["id"]);
    expect(rows.map((r) => r.id)).toEqual(rowsOf(1500).map((r) => r.id));
  });

  it("throws on an error instead of returning a partial list", async () => {
    const { client } = createFakeClient({ tables: { books: rowsOf(3) }, failTables: ["books"] });
    await expect(fetchAllRows(client, "books", ["id"])).rejects.toThrow(/boom books/);
  });
});

describe("listAllObjects", () => {
  it("recurses into folders and pages through each one", async () => {
    const objects: Record<string, Uint8Array> = {};
    for (let i = 0; i < 250; i += 1) objects[`user-a/${String(i).padStart(3, "0")}.epub`] = new Uint8Array([1]);
    objects["user-b/book.epub"] = new Uint8Array([2]);
    objects["user-b/nested/deep/cover.jpg"] = new Uint8Array([3]);
    const { client, calls } = createFakeClient({ objects });
    const paths = await listAllObjects(client, "epubs");
    expect(paths).toHaveLength(252);
    expect(paths).toContain("user-b/nested/deep/cover.jpg");
    const userA = calls.listCalls.filter((c) => c.prefix === "user-a");
    expect(userA.map((c) => c.offset)).toEqual([0, 100, 200]);
  });

  it("returns nothing for an empty bucket", async () => {
    const { client } = createFakeClient({});
    expect(await listAllObjects(client, "epubs")).toEqual([]);
  });
});

describe("listAuthUserIds", () => {
  it("pages until a short page", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `u${i}`);
    const { client } = createFakeClient({ authUserIds: ids });
    const found = await listAuthUserIds(client, { perPage: 10 });
    expect(found.size).toBe(25);
  });
});
