// Share and unshare of personal annotations to a group read (NOTES_PLAN §4.2–4.3).
// Query shapes, the derived kind, the quote caps and the idempotent path, with a
// mocked client. RLS is covered by the integrator-only suite.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Annotation } from "@/lib/types";
import {
  NOTE_MAX,
  QUOTE_CONTEXT_MAX,
  QUOTE_SHARE_MAX,
  listSharedReads,
  shareAnnotation,
  shareQuote,
  unshareAnnotation,
} from "./read-notes";

type Result = { data?: unknown; error?: unknown };

interface Op {
  table: string;
  insert?: Record<string, unknown>;
  select?: unknown[];
  delete?: boolean;
  eq: unknown[][];
  single?: boolean;
}

interface Builder {
  insert(row: Record<string, unknown>): Builder;
  select(...args: unknown[]): Builder;
  delete(): Builder;
  eq(...args: unknown[]): Builder;
  single(): Promise<Result>;
  then: Promise<Result>["then"];
}

/**
 * A chainable fake. Results are consumed in order, one per terminal call (`single()` or
 * an awaited chain). Every `from(table)` is recorded in `ops`.
 */
function fakeClient(...results: Result[]) {
  const queue = [...results];
  const ops: Op[] = [];
  const next = (): Result => queue.shift() ?? { data: null, error: null };
  const from = vi.fn((table: string): Builder => {
    const op: Op = { table, eq: [] };
    ops.push(op);
    const builder: Builder = {
      insert: (row) => ((op.insert = row), builder),
      select: (...args) => ((op.select = args), builder),
      delete: () => ((op.delete = true), builder),
      eq: (...args) => (op.eq.push(args), builder),
      single: () => ((op.single = true), Promise.resolve(next())),
      then: (onOk, onErr) => Promise.resolve(next()).then(onOk, onErr),
    };
    return builder;
  });
  const client = { from } as unknown as SupabaseClient;
  return { client, ops, from };
}

const READ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "11111111-1111-4111-8111-111111111111";
const BOOK = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const ROW_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const UNIQUE_VIOLATION = { code: "23505", message: "duplicate key value" };

const position = { chapterIndex: 2, chapterFraction: 0.5 };

function item(overrides: Partial<Annotation>): Annotation {
  return {
    id: ITEM,
    user_id: USER,
    book_id: BOOK,
    kind: "page",
    cfi: "epubcfi(/6/4!/4/2)",
    quote: null,
    note: null,
    label: "Chapter 2",
    percent: 0.4,
    created_at: "2026-10-17T00:00:00Z",
    updated_at: "2026-10-17T00:00:00Z",
    ...overrides,
  };
}

function range(quote: string, overrides: Partial<Annotation> = {}): Annotation {
  return item({ kind: "range", quote, ...overrides });
}

/** The row sent by the first (insert) call. */
function insertedRow(ops: Op[]): Record<string, unknown> {
  expect(ops[0].insert).toBeDefined();
  return ops[0].insert as Record<string, unknown>;
}

describe("shareQuote: 300-character cap", () => {
  it.each([
    [299, false],
    [300, false],
    [301, true],
  ])("a quote of %i characters: truncated %s", (length, truncated) => {
    const quote = "a".repeat(length);
    const out = shareQuote(quote, "", "");
    expect(out.truncated).toBe(truncated);
    expect(Array.from(out.quote_exact).length).toBe(Math.min(length, QUOTE_SHARE_MAX));
    expect(out.quote_exact).toBe(quote.slice(0, QUOTE_SHARE_MAX));
  });

  it("keeps a quote of exactly 300 characters whole, and cuts 301 to 300", () => {
    expect(shareQuote("a".repeat(300), "", "").quote_exact).toBe("a".repeat(300));
    expect(shareQuote("a".repeat(301), "", "").quote_exact).toBe("a".repeat(300));
  });

  it("counts an emoji as one character at the boundary and never splits it", () => {
    // 299 letters + one emoji = 300 code points (301 UTF-16 units): not cut.
    const exactly = "a".repeat(299) + "😀";
    expect(exactly.length).toBe(301);
    expect(shareQuote(exactly, "", "")).toMatchObject({ quote_exact: exactly, truncated: false });

    // 299 letters + one emoji + one letter = 301 code points: cut before the letter.
    const over = "a".repeat(299) + "😀" + "b";
    expect(shareQuote(over, "", "")).toMatchObject({
      quote_exact: "a".repeat(299) + "😀",
      truncated: true,
    });

    // 299 letters + two emoji: the cut lands between the emoji, so the second is dropped whole.
    const straddle = "a".repeat(299) + "😀😀";
    const cut = shareQuote(straddle, "", "");
    expect(cut.quote_exact).toBe("a".repeat(299) + "😀");
    expect(Array.from(cut.quote_exact).length).toBe(300);
  });

  it("trims trailing whitespace after cutting, but leaves an uncut quote as it is", () => {
    const cut = shareQuote("a".repeat(299) + " b", "", "");
    expect(cut).toMatchObject({ quote_exact: "a".repeat(299), truncated: true });

    const uncut = "a".repeat(298) + "  ";
    expect(shareQuote(uncut, "", "").quote_exact).toBe(uncut);
  });
});

describe("shareQuote: prefix and suffix caps", () => {
  it("keeps the last 32 characters of the prefix, nearest the quote", () => {
    const prefix = "A".repeat(8) + "B".repeat(QUOTE_CONTEXT_MAX);
    expect(shareQuote("q", prefix, "").quote_prefix).toBe("B".repeat(QUOTE_CONTEXT_MAX));
  });

  it("keeps the first 32 characters of the suffix, nearest the quote", () => {
    const suffix = "C".repeat(QUOTE_CONTEXT_MAX) + "D".repeat(8);
    expect(shareQuote("q", "", suffix).quote_suffix).toBe("C".repeat(QUOTE_CONTEXT_MAX));
  });

  it("returns short context whole and empty context as empty", () => {
    expect(shareQuote("q", "ab", "cd")).toMatchObject({ quote_prefix: "ab", quote_suffix: "cd" });
    expect(shareQuote("q", "", "")).toMatchObject({ quote_prefix: "", quote_suffix: "" });
  });

  it("counts context by code points, so an emoji is one character", () => {
    expect(shareQuote("q", "😀".repeat(33), "😀".repeat(33)).quote_prefix).toBe("😀".repeat(32));
    expect(shareQuote("q", "", "😀".repeat(33)).quote_suffix).toBe("😀".repeat(32));
  });

  it("drops the suffix when the quote is truncated, and keeps the prefix", () => {
    const out = shareQuote("x".repeat(301), "pre", "suf");
    expect(out.truncated).toBe(true);
    expect(out.quote_suffix).toBe("");
    expect(out.quote_prefix).toBe("pre");
  });
});

describe("shareAnnotation: kind derivation", () => {
  it("a page with no note shares as a mark, with no quote and a null note", async () => {
    const { client, ops } = fakeClient({ data: { id: ROW_ID }, error: null });
    const out = await shareAnnotation({ annotation: item({}), readId: READ, userId: USER, position }, client);
    const row = insertedRow(ops);
    expect(row).toMatchObject({
      kind: "mark",
      note: null,
      quote_exact: null,
      quote_prefix: null,
      quote_suffix: null,
    });
    expect(out).toEqual({ id: ROW_ID, truncated: false });
  });

  it("a page with a note shares as a note, with the trimmed note", async () => {
    const { client, ops } = fakeClient({ data: { id: ROW_ID }, error: null });
    await shareAnnotation(
      { annotation: item({ note: "  Remember this  " }), readId: READ, userId: USER, position },
      client,
    );
    expect(insertedRow(ops)).toMatchObject({ kind: "note", note: "Remember this", quote_exact: null });
  });

  it("a page whose note is only whitespace shares as a mark", async () => {
    const { client, ops } = fakeClient({ data: { id: ROW_ID }, error: null });
    await shareAnnotation({ annotation: item({ note: "   " }), readId: READ, userId: USER, position }, client);
    expect(insertedRow(ops)).toMatchObject({ kind: "mark", note: null });
  });

  it("a range shares as a highlight with its quote, prefix, suffix and note", async () => {
    const { client, ops } = fakeClient({ data: { id: ROW_ID }, error: null });
    const out = await shareAnnotation(
      {
        annotation: range("the selected words", { note: "Good line" }),
        readId: READ,
        userId: USER,
        position,
        prefix: "Before the words. ",
        suffix: " After the words.",
        contentSha256: "abc123",
      },
      client,
    );
    expect(insertedRow(ops)).toMatchObject({
      annotation_id: ITEM,
      read_id: READ,
      user_id: USER,
      chapter_index: 2,
      chapter_fraction: 0.5,
      kind: "highlight",
      note: "Good line",
      quote_exact: "the selected words",
      quote_prefix: "Before the words. ",
      quote_suffix: " After the words.",
      cfi: "epubcfi(/6/4!/4/2)",
      content_sha256: "abc123",
    });
    expect(out).toEqual({ id: ROW_ID, truncated: false });
  });

  it("a range with no note shares as a highlight with a null note and no context given", async () => {
    const { client, ops } = fakeClient({ data: { id: ROW_ID }, error: null });
    await shareAnnotation({ annotation: range("words"), readId: READ, userId: USER, position }, client);
    expect(insertedRow(ops)).toMatchObject({
      kind: "highlight",
      note: null,
      quote_exact: "words",
      quote_prefix: "",
      quote_suffix: "",
    });
  });

  it("a long range is cut to 300, and the result reports truncated", async () => {
    const { client, ops } = fakeClient({ data: { id: ROW_ID }, error: null });
    const out = await shareAnnotation(
      { annotation: range("z".repeat(450)), readId: READ, userId: USER, position, suffix: "tail" },
      client,
    );
    expect(insertedRow(ops)).toMatchObject({
      quote_exact: "z".repeat(QUOTE_SHARE_MAX),
      quote_suffix: "",
    });
    expect(out).toEqual({ id: ROW_ID, truncated: true });
  });

  it("a range with no quote text is refused before sending", async () => {
    const { client, from } = fakeClient();
    await expect(
      shareAnnotation({ annotation: range(""), readId: READ, userId: USER, position }, client),
    ).rejects.toThrow(/quoted text/);
    expect(from).not.toHaveBeenCalled();
  });

  it("a note over NOTE_MAX characters is refused before sending", async () => {
    const { client, from } = fakeClient();
    await expect(
      shareAnnotation(
        { annotation: item({ note: "n".repeat(NOTE_MAX + 1) }), readId: READ, userId: USER, position },
        client,
      ),
    ).rejects.toThrow(/1 to 500/);
    expect(from).not.toHaveBeenCalled();
  });

  it("clamps the position into range", async () => {
    const { client, ops } = fakeClient({ data: { id: ROW_ID }, error: null });
    await shareAnnotation(
      {
        annotation: item({}),
        readId: READ,
        userId: USER,
        position: { chapterIndex: -2.9, chapterFraction: 7 },
      },
      client,
    );
    expect(insertedRow(ops)).toMatchObject({ chapter_index: 0, chapter_fraction: 1 });
  });
});

describe("shareAnnotation: idempotent share", () => {
  it("returns the existing row when the (annotation, read) pair is already shared", async () => {
    const { client, ops } = fakeClient(
      { data: null, error: UNIQUE_VIOLATION },
      { data: { id: ROW_ID }, error: null },
    );
    const out = await shareAnnotation({ annotation: item({}), readId: READ, userId: USER, position }, client);
    expect(out).toEqual({ id: ROW_ID, truncated: false });

    expect(ops).toHaveLength(2);
    expect(ops[1]).toMatchObject({ table: "read_notes", select: ["id"], single: true });
    expect(ops[1].eq).toEqual([
      ["annotation_id", ITEM],
      ["read_id", READ],
    ]);
  });

  it("reports truncated from the quote even when the row already existed", async () => {
    const { client } = fakeClient(
      { data: null, error: UNIQUE_VIOLATION },
      { data: { id: ROW_ID }, error: null },
    );
    const out = await shareAnnotation(
      { annotation: range("q".repeat(400)), readId: READ, userId: USER, position },
      client,
    );
    expect(out).toEqual({ id: ROW_ID, truncated: true });
  });

  it("rethrows any other insert error without looking up a row", async () => {
    const error = { code: "42501", message: "new row violates row-level security policy" };
    const { client, ops } = fakeClient({ data: null, error });
    await expect(
      shareAnnotation({ annotation: item({}), readId: READ, userId: USER, position }, client),
    ).rejects.toBe(error);
    expect(ops).toHaveLength(1);
  });

  it("throws when the existing row cannot be read back", async () => {
    const lookupError = { code: "PGRST116", message: "no rows" };
    const { client } = fakeClient(
      { data: null, error: UNIQUE_VIOLATION },
      { data: null, error: lookupError },
    );
    await expect(
      shareAnnotation({ annotation: item({}), readId: READ, userId: USER, position }, client),
    ).rejects.toBe(lookupError);
  });
});

describe("unshareAnnotation", () => {
  it("deletes the read_notes row for this item and read", async () => {
    const { client, ops } = fakeClient();
    await unshareAnnotation(ITEM, READ, client);
    expect(ops[0]).toMatchObject({ table: "read_notes", delete: true });
    expect(ops[0].eq).toEqual([
      ["annotation_id", ITEM],
      ["read_id", READ],
    ]);
  });

  it("throws the Postgrest error", async () => {
    const error = { code: "XX000", message: "boom" };
    const { client } = fakeClient({ data: null, error });
    await expect(unshareAnnotation(ITEM, READ, client)).rejects.toBe(error);
  });

  it("requires an explicit client", async () => {
    await expect(unshareAnnotation(ITEM, READ)).rejects.toThrow(/explicit Supabase client/);
  });
});

describe("listSharedReads", () => {
  it("selects my read_notes rows linked to this item and returns them", async () => {
    const rows = [{ id: ROW_ID, read_id: READ, annotation_id: ITEM }];
    const { client, ops } = fakeClient({ data: rows, error: null });
    await expect(listSharedReads(ITEM, client)).resolves.toEqual(rows);
    expect(ops[0]).toMatchObject({ table: "read_notes", select: ["*"] });
    expect(ops[0].eq).toEqual([["annotation_id", ITEM]]);
  });

  it("returns an empty list when nothing is shared", async () => {
    const { client } = fakeClient({ data: null, error: null });
    await expect(listSharedReads(ITEM, client)).resolves.toEqual([]);
  });

  it("requires an explicit client", async () => {
    await expect(listSharedReads(ITEM)).rejects.toThrow(/explicit Supabase client/);
  });
});
