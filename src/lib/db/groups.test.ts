// Query shapes for the groups data client: which table, which filters, which row is
// written. RLS itself is covered by groups-rls.integration.test.ts (integrator only).

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Alignment } from "@/lib/groups/types";
import {
  findReadForBook,
  getGroup,
  getMyCopy,
  getReadProgress,
  getMyProgress,
  linkMyCopy,
  listMilestones,
  listMyGroups,
  listReads,
  outlinePercent,
  parseAlignment,
  parseOutline,
  setCopyAlignment,
  setGroupProgress,
  setManualProgress,
} from "./groups";

type Result = { data?: unknown; error?: unknown };

interface Call {
  from: string;
  select?: unknown[];
  update?: unknown;
  upsert?: unknown[];
  eq: unknown[][];
  order: unknown[][];
}

/**
 * A chainable fake. Each `from(table)` call takes the next queued result, so a
 * function that queries twice can be given two. `rpc` has its own result.
 */
function fakeClient(results: Result[] = [{ data: null, error: null }], rpc?: Result) {
  const calls: Call[] = [];
  const rpcCalls: unknown[][] = [];
  const queue = [...results];
  const from = vi.fn((table: string) => {
    const result = queue.length > 1 ? queue.shift()! : queue[0];
    const call: Call = { from: table, eq: [], order: [] };
    calls.push(call);
    const builder = {
      select: (...a: unknown[]) => ((call.select = a), builder),
      update: (...a: unknown[]) => ((call.update = a[0]), builder),
      upsert: (...a: unknown[]) => ((call.upsert = a), builder),
      eq: (...a: unknown[]) => (call.eq.push(a), builder),
      order: (...a: unknown[]) => (call.order.push(a), builder),
      maybeSingle: () => Promise.resolve(result),
      then: (fn: (r: Result) => unknown) => Promise.resolve(fn(result)),
    };
    return builder;
  });
  const rpcFn = vi.fn((...a: unknown[]) => {
    rpcCalls.push(a);
    return Promise.resolve(rpc ?? { data: [], error: null });
  });
  return { client: { from, rpc: rpcFn } as unknown as SupabaseClient, calls, rpcCalls };
}

const storedOutline = [
  { index: 0, label: "Preface", depth: 0, partIndex: null, href: "p.xhtml" },
  { index: 1, label: "I", depth: 1, partIndex: 0, partLabel: "Part One", href: "c1.xhtml" },
  { index: 2, label: "II", depth: 1, partIndex: 0, partLabel: "Part One", href: "c2.xhtml" },
  { index: 3, label: "III", depth: 1, partIndex: 1, partLabel: "Part Two", href: "c3.xhtml" },
];

const alignment: Alignment = {
  map: { "c1.xhtml": 1 },
  copyHrefs: ["c1.xhtml"],
  confidence: 0.25,
  identity: false,
};

describe("parseOutline", () => {
  it("parses the stored shape, keeping partLabel when present", () => {
    const o = parseOutline(storedOutline);
    expect(o).toHaveLength(4);
    expect(o[1]).toEqual({
      index: 1,
      label: "I",
      depth: 1,
      partIndex: 0,
      partLabel: "Part One",
      href: "c1.xhtml",
    });
  });

  it("tolerates missing optional fields", () => {
    const o = parseOutline([{ label: "Only" }, { index: 5, label: "X", href: "x" }]);
    expect(o[0]).toEqual({
      index: 0,
      label: "Only",
      depth: 0,
      partIndex: null,
      partLabel: null,
      href: "",
    });
    expect(o[1]).toMatchObject({ index: 5, depth: 0, partIndex: null, partLabel: null });
  });

  it("skips junk entries and returns [] for a non-array", () => {
    expect(parseOutline([null, 3, "x", { label: "ok" }])).toHaveLength(1);
    expect(parseOutline(null)).toEqual([]);
    expect(parseOutline({ a: 1 })).toEqual([]);
  });
});

describe("parseAlignment", () => {
  it("round-trips a stored alignment", () => {
    expect(parseAlignment(alignment)).toEqual(alignment);
  });

  it("is null for null or non-objects", () => {
    expect(parseAlignment(null)).toBeNull();
    expect(parseAlignment("x")).toBeNull();
    expect(parseAlignment([])).toBeNull();
  });

  it("fills missing fields: copyHrefs from the map, confidence 0, identity false", () => {
    expect(parseAlignment({ map: { a: 0, b: 1, c: "bad" } })).toEqual({
      map: { a: 0, b: 1 },
      copyHrefs: ["a", "b"],
      confidence: 0,
      identity: false,
    });
  });
});

describe("outlinePercent", () => {
  it("is (index + fraction) / length", () => {
    expect(outlinePercent(4, { chapterIndex: 0, chapterFraction: 0 })).toBe(0);
    expect(outlinePercent(4, { chapterIndex: 2, chapterFraction: 0.5 })).toBeCloseTo(0.625);
    expect(outlinePercent(4, { chapterIndex: 3, chapterFraction: 1 })).toBe(1);
  });

  it("clamps out-of-range input and handles an empty outline", () => {
    expect(outlinePercent(4, { chapterIndex: 99, chapterFraction: 5 })).toBe(1);
    expect(outlinePercent(4, { chapterIndex: -3, chapterFraction: -1 })).toBe(0);
    expect(outlinePercent(0, { chapterIndex: 1, chapterFraction: 0.5 })).toBe(0);
  });
});

describe("listMyGroups", () => {
  it("queries my memberships with the group and a member count", async () => {
    const { client, calls } = fakeClient([
      {
        data: [
          {
            role: "owner",
            groups: {
              id: "g1",
              name: "Club",
              created_at: "t",
              group_members: [{ count: 3 }],
            },
          },
          { role: "member", groups: null },
        ],
        error: null,
      },
    ]);
    const mine = await listMyGroups("u1", client);

    expect(calls[0].from).toBe("group_members");
    expect(calls[0].select?.[0]).toContain("groups(");
    expect(calls[0].select?.[0]).toContain("group_members(count)");
    expect(calls[0].eq).toEqual([["user_id", "u1"]]);
    expect(mine).toEqual([
      { group: { id: "g1", name: "Club", created_at: "t" }, role: "owner", memberCount: 3 },
    ]);
  });

  it("throws on a Postgrest error", async () => {
    const { client } = fakeClient([{ error: { code: "42501", message: "denied" } }]);
    await expect(listMyGroups("u1", client)).rejects.toMatchObject({ code: "42501" });
  });

  it("requires an explicit client", async () => {
    await expect(listMyGroups("u1")).rejects.toThrow(/explicit Supabase client/);
  });
});

describe("getGroup", () => {
  it("reads the group, then its members through the group_member_names rpc", async () => {
    const members = [
      { user_id: "u1", display_name: "A", role: "owner", joined_at: "t" },
    ];
    const { client, calls, rpcCalls } = fakeClient(
      [{ data: { id: "g1", name: "Club", created_at: "t" }, error: null }],
      { data: members, error: null },
    );
    const detail = await getGroup("g1", client);

    expect(calls[0].from).toBe("groups");
    expect(calls[0].eq).toEqual([["id", "g1"]]);
    expect(rpcCalls).toEqual([["group_member_names", { gid: "g1" }]]);
    expect(detail).toEqual({
      group: { id: "g1", name: "Club", created_at: "t" },
      members,
    });
  });

  it("is null, with no rpc, when the group is not visible", async () => {
    const { client, rpcCalls } = fakeClient([{ data: null, error: null }]);
    expect(await getGroup("g1", client)).toBeNull();
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("listReads", () => {
  it("filters by group, oldest first, and parses outlines", async () => {
    const { client, calls } = fakeClient([
      {
        data: [{ id: "r1", group_id: "g1", title: "T", outline: storedOutline }],
        error: null,
      },
    ]);
    const reads = await listReads("g1", client);

    expect(calls[0].from).toBe("group_reads");
    expect(calls[0].eq).toEqual([["group_id", "g1"]]);
    expect(calls[0].order).toEqual([["created_at", { ascending: true }]]);
    expect(reads[0].outline[3]).toMatchObject({ index: 3, partLabel: "Part Two" });
  });
});

describe("progress and milestones", () => {
  it("getReadProgress reads every member's row for the read", async () => {
    const rows = [{ read_id: "r1", user_id: "u1" }];
    const { client, calls } = fakeClient([{ data: rows, error: null }]);
    expect(await getReadProgress("r1", client)).toEqual(rows);
    expect(calls[0].from).toBe("read_progress");
    expect(calls[0].eq).toEqual([["read_id", "r1"]]);
  });

  it("getMyProgress scopes to the user and is null when absent", async () => {
    const { client, calls } = fakeClient([{ data: null, error: null }]);
    expect(await getMyProgress("u1", "r1", client)).toBeNull();
    expect(calls[0].eq).toEqual([
      ["read_id", "r1"],
      ["user_id", "u1"],
    ]);
  });

  it("listMilestones orders by arrival (reached_at ascending)", async () => {
    const { client, calls } = fakeClient([{ data: [], error: null }]);
    await listMilestones("r1", client);
    expect(calls[0].from).toBe("read_milestones");
    expect(calls[0].eq).toEqual([["read_id", "r1"]]);
    expect(calls[0].order).toEqual([["reached_at", { ascending: true }]]);
  });
});

describe("my copy", () => {
  it("getMyCopy scopes to read and user and parses the alignment", async () => {
    const { client, calls } = fakeClient([
      {
        data: { read_id: "r1", user_id: "u1", book_id: "b1", content_sha256: "abc", alignment },
        error: null,
      },
    ]);
    const copy = await getMyCopy("u1", "r1", client);
    expect(calls[0].from).toBe("read_copies");
    expect(calls[0].eq).toEqual([
      ["read_id", "r1"],
      ["user_id", "u1"],
    ]);
    expect(copy).toEqual({
      readId: "r1",
      bookId: "b1",
      contentSha256: "abc",
      alignment,
    });
  });

  it("getMyCopy is null when there is no copy", async () => {
    const { client } = fakeClient([{ data: null, error: null }]);
    expect(await getMyCopy("u1", "r1", client)).toBeNull();
  });

  it("linkMyCopy upserts my own row on (read_id, user_id)", async () => {
    const { client, calls } = fakeClient();
    await linkMyCopy("u1", "r1", "b1", alignment, null, client);
    expect(calls[0].from).toBe("read_copies");
    expect(calls[0].upsert).toEqual([
      {
        read_id: "r1",
        user_id: "u1",
        book_id: "b1",
        content_sha256: null,
        alignment,
      },
      { onConflict: "read_id,user_id" },
    ]);
  });

  it("setCopyAlignment updates only the alignment of my row", async () => {
    const { client, calls } = fakeClient();
    await setCopyAlignment("u1", "r1", alignment, client);
    expect(calls[0].update).toEqual({ alignment });
    expect(calls[0].eq).toEqual([
      ["read_id", "r1"],
      ["user_id", "u1"],
    ]);
  });

  it("throws on a Postgrest error", async () => {
    const { client } = fakeClient([{ error: { code: "42501", message: "denied" } }]);
    await expect(linkMyCopy("u1", "r1", "b1", alignment, null, client)).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("findReadForBook", () => {
  it("looks up my copies of the book with their read embedded, outline parsed", async () => {
    const { client, calls } = fakeClient([
      {
        data: [
          {
            read_id: "r1",
            user_id: "u1",
            book_id: "b1",
            content_sha256: null,
            alignment,
            group_reads: { id: "r1", group_id: "g1", title: "T", outline: storedOutline },
          },
          // read no longer visible: skipped
          { read_id: "r2", book_id: "b1", content_sha256: null, alignment: null, group_reads: null },
        ],
        error: null,
      },
    ]);
    const found = await findReadForBook("u1", "b1", client);

    expect(calls[0].from).toBe("read_copies");
    expect(calls[0].select?.[0]).toContain("group_reads(");
    expect(calls[0].eq).toEqual([
      ["user_id", "u1"],
      ["book_id", "b1"],
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].read.id).toBe("r1");
    expect(found[0].read.outline).toHaveLength(4);
    expect(found[0].copy.alignment).toEqual(alignment);
  });

  it("is empty for an unlinked book", async () => {
    const { client } = fakeClient([{ data: [], error: null }]);
    expect(await findReadForBook("u1", "b1", client)).toEqual([]);
  });
});

describe("setManualProgress", () => {
  it("derives percent from the outline and upserts my row with manual = true", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00.000Z"));
    try {
      const { client, calls } = fakeClient([
        { data: { outline: storedOutline }, error: null },
        { error: null },
      ]);
      await setManualProgress("u1", "r1", { chapterIndex: 2, chapterFraction: 0.5 }, client);

      expect(calls[0].from).toBe("group_reads");
      expect(calls[0].eq).toEqual([["id", "r1"]]);
      expect(calls[1].from).toBe("read_progress");
      expect(calls[1].upsert).toEqual([
        {
          read_id: "r1",
          user_id: "u1",
          chapter_index: 2,
          chapter_fraction: 0.5,
          percent: 0.625,
          manual: true,
          updated_at: "2026-10-11T12:00:00.000Z",
        },
        { onConflict: "read_id,user_id" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not write finished_at (the trigger records the end milestone from position)", async () => {
    const { client, calls } = fakeClient([
      { data: { outline: storedOutline }, error: null },
      { error: null },
    ]);
    await setManualProgress("u1", "r1", { chapterIndex: 3, chapterFraction: 1 }, client);
    expect(calls[1].upsert?.[0]).not.toHaveProperty("finished_at");
  });

  it("clamps a chapter beyond the outline to the last chapter", async () => {
    const { client, calls } = fakeClient([
      { data: { outline: storedOutline }, error: null },
      { error: null },
    ]);
    await setManualProgress("u1", "r1", { chapterIndex: 40, chapterFraction: 2 }, client);
    expect(calls[1].upsert?.[0]).toMatchObject({
      chapter_index: 3,
      chapter_fraction: 1,
      percent: 1,
    });
  });

  it("throws, and writes nothing, when the read is not visible", async () => {
    const { client, calls } = fakeClient([{ data: null, error: null }]);
    await expect(
      setManualProgress("u1", "r1", { chapterIndex: 1, chapterFraction: 0 }, client),
    ).rejects.toThrow(/not found/);
    expect(calls).toHaveLength(1);
  });

  it("throws on a write error", async () => {
    const { client } = fakeClient([
      { data: { outline: storedOutline }, error: null },
      { error: { code: "42501", message: "denied" } },
    ]);
    await expect(
      setManualProgress("u1", "r1", { chapterIndex: 1, chapterFraction: 0 }, client),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("setGroupProgress", () => {
  const payload = {
    userId: "u1",
    readId: "r1",
    chapterIndex: 2,
    chapterFraction: 0.4,
    percent: 0.35,
    finishedAt: null,
  };

  it("upserts my row with manual = false", async () => {
    const { client, calls } = fakeClient();
    await setGroupProgress(payload, client, "2026-10-11T09:00:00.000Z");

    expect(calls[0].from).toBe("read_progress");
    expect(calls[0].upsert).toEqual([
      {
        read_id: "r1",
        user_id: "u1",
        chapter_index: 2,
        chapter_fraction: 0.4,
        percent: 0.35,
        finished_at: null,
        manual: false,
        updated_at: "2026-10-11T09:00:00.000Z",
      },
      { onConflict: "read_id,user_id" },
    ]);
  });

  it("defaults updated_at to now", async () => {
    const { client, calls } = fakeClient();
    const before = Date.now();
    await setGroupProgress(payload, client);
    const row = calls[0].upsert?.[0] as { updated_at: string };
    expect(Date.parse(row.updated_at)).toBeGreaterThanOrEqual(before);
  });

  it("carries finishedAt through and clamps values into the column ranges", async () => {
    const { client, calls } = fakeClient();
    await setGroupProgress(
      {
        ...payload,
        chapterIndex: -2,
        chapterFraction: 1.5,
        percent: 2,
        finishedAt: "2026-10-11T10:00:00.000Z",
      },
      client,
    );
    expect(calls[0].upsert?.[0]).toMatchObject({
      chapter_index: 0,
      chapter_fraction: 1,
      percent: 1,
      finished_at: "2026-10-11T10:00:00.000Z",
    });
  });

  it("throws on a Postgrest error", async () => {
    const { client } = fakeClient([{ error: { code: "42501", message: "denied" } }]);
    await expect(setGroupProgress(payload, client)).rejects.toMatchObject({ code: "42501" });
  });
});
