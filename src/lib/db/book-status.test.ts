// `setBookFinished` — assert the query shape: both columns written together
// (the DB's `books_finished_consistent` CHECK demands it), owner scoping, and —
// the load-bearing part — that the finished path only touches a row that is not
// already finished, so the first finish date survives repeats and stale replays.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setBookFinished } from "./book-status";

function fakeClient(result: { error: unknown } = { error: null }) {
  const calls: {
    from?: string;
    update?: unknown;
    eq: unknown[][];
    is: unknown[][];
  } = { eq: [], is: [] };
  const builder = {
    update: (...a: unknown[]) => ((calls.update = a[0]), builder),
    eq: (...a: unknown[]) => (calls.eq.push(a), builder),
    is: (...a: unknown[]) => (calls.is.push(a), builder),
    then: (fn: (r: typeof result) => unknown) => Promise.resolve(fn(result)),
  };
  const from = vi.fn((table: string) => ((calls.from = table), builder));
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("setBookFinished — finished", () => {
  it("sets status and finished_at together, scoped to the owner's book", async () => {
    const { client, calls } = fakeClient();
    await setBookFinished("u1", "b1", "2026-10-02T10:00:00.000Z", client);

    expect(calls.from).toBe("books");
    expect(calls.update).toEqual({
      status: "finished",
      finished_at: "2026-10-02T10:00:00.000Z",
    });
    expect(calls.eq).toEqual([
      ["id", "b1"],
      ["user_id", "u1"],
    ]);
  });

  it("only touches a row that is not already finished (keeps the first finish date)", async () => {
    const { client, calls } = fakeClient();
    await setBookFinished("u1", "b1", "2026-10-02T10:00:00.000Z", client);
    expect(calls.is).toEqual([["finished_at", null]]);
  });

  it("throws on a Postgrest error", async () => {
    const { client } = fakeClient({ error: { code: "42501", message: "denied" } });
    await expect(
      setBookFinished("u1", "b1", "2026-10-02T10:00:00.000Z", client),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("setBookFinished — unread", () => {
  it("clears both columns, unconditionally, scoped to the owner's book", async () => {
    const { client, calls } = fakeClient();
    await setBookFinished("u1", "b1", null, client);

    expect(calls.update).toEqual({ status: "reading", finished_at: null });
    expect(calls.eq).toEqual([
      ["id", "b1"],
      ["user_id", "u1"],
    ]);
    // No `finished_at is null` guard: un-finishing must work on a finished row.
    expect(calls.is).toEqual([]);
  });

  it("throws on a Postgrest error", async () => {
    const { client } = fakeClient({ error: { code: "", message: "Failed to fetch" } });
    await expect(setBookFinished("u1", "b1", null, client)).rejects.toMatchObject({
      message: "Failed to fetch",
    });
  });
});

describe("setBookFinished — client", () => {
  it("refuses to run without an explicit client", async () => {
    await expect(setBookFinished("u1", "b1", null)).rejects.toThrow(/explicit Supabase client/);
  });
});
