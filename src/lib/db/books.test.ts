import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  select: vi.fn(),
  filter: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: (cols: string) => {
        h.select(cols);
        // The real builder is thenable and keeps chaining, so the mock has to
        // be too: listBooks adds `.is(...)` / `.not(...)` after `.order(...)`.
        const result = { data: h.rows, error: null };
        const builder = {
          eq: () => builder,
          order: () => builder,
          is: (col: string, val: unknown) => {
            h.filter("is", col, val);
            return Promise.resolve(result);
          },
          not: (col: string, op: string, val: unknown) => {
            h.filter("not", col, op, val);
            return Promise.resolve(result);
          },
          then: (fn: (r: typeof result) => unknown) => Promise.resolve(fn(result)),
        };
        return builder;
      },
    }),
  })),
}));

import { listBooks } from "./books";

function book(
  id: string,
  addedAt: string,
  state?: { percent: number; updated_at: string },
) {
  return {
    id,
    user_id: "u1",
    title: id,
    author: "A",
    source: "upload",
    source_ref: null,
    storage_path: `u1/${id}.epub`,
    cover_url: null,
    archived_at: null,
    status: "reading",
    added_at: addedAt,
    reading_state: state ? [state] : [],
  };
}

beforeEach(() => {
  h.rows = [];
  h.select.mockClear();
  h.filter.mockClear();
});

describe("listBooks", () => {
  it("asks for the reading state alongside the book", async () => {
    await listBooks("u1");
    expect(h.select).toHaveBeenCalledWith(
      expect.stringContaining("reading_state(percent, updated_at)"),
    );
  });

  it("shows only visible books by default, and only hidden ones on request", async () => {
    await listBooks("u1");
    expect(h.filter).toHaveBeenCalledWith("is", "archived_at", null);

    h.filter.mockClear();
    await listBooks("u1", { archived: true });
    expect(h.filter).toHaveBeenCalledWith("not", "archived_at", "is", null);
  });

  it("puts the most recently read book first", async () => {
    h.rows = [
      book("older-read", "2026-01-01T00:00:00Z", {
        percent: 0.1,
        updated_at: "2026-03-01T00:00:00Z",
      }),
      book("newest-read", "2026-01-01T00:00:00Z", {
        percent: 0.9,
        updated_at: "2026-06-01T00:00:00Z",
      }),
    ];
    const out = await listBooks("u1");
    expect(out.map((b) => b.id)).toEqual(["newest-read", "older-read"]);
  });

  it("ranks started books above never-opened ones, however new", async () => {
    h.rows = [
      book("never-opened", "2026-09-01T00:00:00Z"),
      book("started-long-ago", "2026-01-01T00:00:00Z", {
        percent: 0.2,
        updated_at: "2026-02-01T00:00:00Z",
      }),
    ];
    const out = await listBooks("u1");
    expect(out.map((b) => b.id)).toEqual(["started-long-ago", "never-opened"]);
  });

  it("falls back to newest-added among books never opened", async () => {
    h.rows = [
      book("old", "2026-01-01T00:00:00Z"),
      book("new", "2026-08-01T00:00:00Z"),
    ];
    const out = await listBooks("u1");
    expect(out.map((b) => b.id)).toEqual(["new", "old"]);
  });

  it("flattens the embedded state onto the book", async () => {
    h.rows = [
      book("b", "2026-01-01T00:00:00Z", {
        percent: 0.42,
        updated_at: "2026-06-01T00:00:00Z",
      }),
    ];
    const [b] = await listBooks("u1");
    expect(b.percent).toBe(0.42);
    expect(b.lastReadAt).toBe("2026-06-01T00:00:00Z");
    expect("reading_state" in b).toBe(false);
  });

  it("reports a never-opened book as null progress, not zero", async () => {
    // 0% and "never opened" are different things on the shelf.
    h.rows = [book("b", "2026-01-01T00:00:00Z")];
    const [b] = await listBooks("u1");
    expect(b.percent).toBeNull();
    expect(b.lastReadAt).toBeNull();
  });
});
