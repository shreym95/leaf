// The schedule on a read as the data layer hands it to the UI: stored jsonb is parsed
// tolerantly, so a malformed row never reaches the display as-is.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listReads } from "./groups";

function clientReturning(rows: unknown[]): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: vi.fn(() => builder) } as unknown as SupabaseClient;
}

const base = {
  group_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Book",
  author: "Author",
  source: "upload",
  source_ref: null,
  outline: [{ index: 0, label: "One", depth: 0, partIndex: null, href: "a" }],
  created_by: null,
  created_at: "2026-10-17T00:00:00Z",
};

describe("listReads schedule parsing", () => {
  it("passes a valid stored schedule through", async () => {
    const [read] = await listReads(
      base.group_id,
      clientReturning([
        { id: "r1", ...base, schedule: [{ chapter_index: 0, due_on: "2026-11-06" }] },
      ]),
    );
    expect(read.schedule).toEqual([{ chapter_index: 0, due_on: "2026-11-06" }]);
  });

  it("is null when the stored schedule is null", async () => {
    const [read] = await listReads(base.group_id, clientReturning([{ id: "r1", ...base, schedule: null }]));
    expect(read.schedule).toBeNull();
  });

  it("drops malformed stored items and nulls a schedule with nothing valid left", async () => {
    const [read] = await listReads(
      base.group_id,
      clientReturning([
        { id: "r1", ...base, schedule: [{ chapter_index: 0, due_on: "2026-02-30" }] },
      ]),
    );
    expect(read.schedule).toBeNull();
  });
});
