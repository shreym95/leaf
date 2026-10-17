// Query shapes for group notes: the RPC name and args, the row written, and the
// checks done before anything is sent. RLS is covered by the integrator-only suite.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReadNote, VisibleReadNote } from "@/lib/types";
import {
  NOTE_MAX,
  addReadNote,
  deleteReadNote,
  listVisibleNotes,
  normaliseNoteText,
  notesByChapter,
} from "./read-notes";

type Result = { data?: unknown; error?: unknown };

interface Call {
  table: string;
  insert?: unknown;
  select?: unknown[];
  delete?: boolean;
  eq: unknown[][];
  single?: boolean;
}

/** A chainable fake. `rpc` has its own result. Every `from(table)` is recorded. */
function fakeClient(result: Result = { data: null, error: null }, rpcResult: Result = { data: [], error: null }) {
  const calls: Call[] = [];
  const rpcCalls: unknown[][] = [];
  const from = vi.fn((table: string) => {
    const call: Call = { table, eq: [] };
    calls.push(call);
    const builder = {
      insert: (row: unknown) => ((call.insert = row), builder),
      select: (...a: unknown[]) => ((call.select = a), builder),
      delete: () => ((call.delete = true), builder),
      eq: (...a: unknown[]) => (call.eq.push(a), builder),
      single: () => ((call.single = true), Promise.resolve(result)),
      then: (fn: (r: Result) => unknown) => Promise.resolve(result).then(fn),
    };
    return builder;
  });
  const rpc = vi.fn(async (...a: unknown[]) => {
    rpcCalls.push(a);
    return rpcResult;
  });
  const client = { from, rpc } as unknown as SupabaseClient;
  return { client, calls, rpcCalls, from, rpc };
}

const READ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const storedRow: ReadNote = {
  id: NOTE_ID,
  read_id: READ,
  user_id: USER,
  chapter_index: 2,
  chapter_fraction: 0.5,
  kind: "note",
  note: "Remember this",
  quote_exact: null,
  quote_prefix: null,
  quote_suffix: null,
  cfi: null,
  content_sha256: null,
  created_at: "2026-10-17T00:00:00Z",
};

describe("listVisibleNotes", () => {
  it("calls visible_notes with the read id and returns its rows", async () => {
    const rows: VisibleReadNote[] = [
      {
        id: NOTE_ID,
        read_id: READ,
        user_id: USER,
        chapter_index: 1,
        chapter_fraction: 0.2,
        kind: "mark",
        note: null,
        cfi: null,
        content_sha256: null,
        created_at: "2026-10-17T00:00:00Z",
      },
    ];
    const { client, rpc } = fakeClient(undefined, { data: rows, error: null });
    await expect(listVisibleNotes(READ, client)).resolves.toEqual(rows);
    expect(rpc).toHaveBeenCalledWith("visible_notes", { rid: READ });
  });

  it("returns an empty list when the RPC returns null", async () => {
    const { client } = fakeClient(undefined, { data: null, error: null });
    await expect(listVisibleNotes(READ, client)).resolves.toEqual([]);
  });

  it("throws the Postgrest error", async () => {
    const error = { code: "42501", message: "denied" };
    const { client } = fakeClient(undefined, { data: null, error });
    await expect(listVisibleNotes(READ, client)).rejects.toBe(error);
  });

  it("requires an explicit client", async () => {
    await expect(listVisibleNotes(READ)).rejects.toThrow(/explicit Supabase client/);
  });
});

describe("addReadNote", () => {
  const position = { chapterIndex: 2, chapterFraction: 0.5 };

  it("writes a note with trimmed text, scoped to my read and user", async () => {
    const { client, calls } = fakeClient({ data: storedRow, error: null });
    const row = await addReadNote(
      { readId: READ, userId: USER, position, kind: "note", note: "  Remember this  " },
      client,
    );
    expect(row).toEqual(storedRow);
    expect(calls[0]).toMatchObject({
      table: "read_notes",
      insert: {
        read_id: READ,
        user_id: USER,
        chapter_index: 2,
        chapter_fraction: 0.5,
        kind: "note",
        note: "Remember this",
        cfi: null,
        content_sha256: null,
      },
      select: ["*"],
      single: true,
    });
  });

  it("writes a mark with note null", async () => {
    const { client, calls } = fakeClient({ data: { ...storedRow, kind: "mark", note: null }, error: null });
    await addReadNote({ readId: READ, userId: USER, position, kind: "mark" }, client);
    expect(calls[0].insert).toMatchObject({ kind: "mark", note: null });
  });

  it("passes cfi and content_sha256 through when given", async () => {
    const { client, calls } = fakeClient({ data: storedRow, error: null });
    await addReadNote(
      {
        readId: READ,
        userId: USER,
        position,
        kind: "mark",
        cfi: "epubcfi(/6/4!/4/2)",
        contentSha256: "abc123",
      },
      client,
    );
    expect(calls[0].insert).toMatchObject({ cfi: "epubcfi(/6/4!/4/2)", content_sha256: "abc123" });
  });

  it("accepts a note of exactly NOTE_MAX characters and rejects one more", async () => {
    expect(normaliseNoteText("note", "a".repeat(NOTE_MAX))).toHaveLength(NOTE_MAX);
    expect(() => normaliseNoteText("note", "a".repeat(NOTE_MAX + 1))).toThrow(/1 to 500/);
  });

  it("counts characters the way Postgres does (code points, not UTF-16 units)", () => {
    const emoji = "😀".repeat(NOTE_MAX);
    expect(emoji.length).toBe(NOTE_MAX * 2);
    expect(normaliseNoteText("note", emoji)).toBe(emoji);
    expect(() => normaliseNoteText("note", "😀".repeat(NOTE_MAX + 1))).toThrow();
  });

  it("rejects a note that is empty, whitespace-only or missing, before sending", async () => {
    for (const note of ["", "   ", "\n\t", undefined, null]) {
      const { client, from } = fakeClient();
      await expect(
        addReadNote({ readId: READ, userId: USER, position, kind: "note", note }, client),
      ).rejects.toThrow(/1 to 500/);
      expect(from).not.toHaveBeenCalled();
    }
  });

  it("rejects text on a mark, before sending", async () => {
    const { client, from } = fakeClient();
    await expect(
      addReadNote({ readId: READ, userId: USER, position, kind: "mark", note: "hi" }, client),
    ).rejects.toThrow(/cannot carry text/);
    expect(from).not.toHaveBeenCalled();
  });

  it("accepts a mark with an empty note string (no text supplied)", () => {
    expect(normaliseNoteText("mark", "")).toBeNull();
    expect(normaliseNoteText("mark", undefined)).toBeNull();
    expect(normaliseNoteText("mark", null)).toBeNull();
  });

  it("refuses highlights in this version, before sending", async () => {
    const { client, from } = fakeClient();
    await expect(
      addReadNote(
        { readId: READ, userId: USER, position, kind: "highlight" as "note", note: "x" },
        client,
      ),
    ).rejects.toThrow(/Highlights/);
    expect(from).not.toHaveBeenCalled();
  });

  it("clamps the position into range", async () => {
    const { client, calls } = fakeClient({ data: storedRow, error: null });
    await addReadNote(
      {
        readId: READ,
        userId: USER,
        position: { chapterIndex: -3.7, chapterFraction: 2 },
        kind: "mark",
      },
      client,
    );
    expect(calls[0].insert).toMatchObject({ chapter_index: 0, chapter_fraction: 1 });

    const second = fakeClient({ data: storedRow, error: null });
    await addReadNote(
      {
        readId: READ,
        userId: USER,
        position: { chapterIndex: NaN, chapterFraction: NaN },
        kind: "mark",
      },
      second.client,
    );
    expect(second.calls[0].insert).toMatchObject({ chapter_index: 0, chapter_fraction: 0 });
  });

  it("throws the Postgrest error from the insert", async () => {
    const error = { code: "42501", message: "new row violates row-level security policy" };
    const { client } = fakeClient({ data: null, error });
    await expect(
      addReadNote({ readId: READ, userId: USER, position, kind: "mark" }, client),
    ).rejects.toBe(error);
  });
});

describe("deleteReadNote", () => {
  it("deletes the note by id", async () => {
    const { client, calls } = fakeClient();
    await deleteReadNote(NOTE_ID, client);
    expect(calls[0]).toMatchObject({ table: "read_notes", delete: true });
    expect(calls[0].eq).toEqual([["id", NOTE_ID]]);
  });

  it("throws the Postgrest error", async () => {
    const error = { code: "XX000", message: "boom" };
    const { client } = fakeClient({ data: null, error });
    await expect(deleteReadNote(NOTE_ID, client)).rejects.toBe(error);
  });

  it("requires an explicit client", async () => {
    await expect(deleteReadNote(NOTE_ID)).rejects.toThrow(/explicit Supabase client/);
  });
});

describe("notesByChapter", () => {
  const note = (id: string, chapter_index: number) => ({ id, chapter_index });

  it("groups notes by chapter and keeps the input order within a chapter", () => {
    const grouped = notesByChapter([
      note("a", 1),
      note("b", 0),
      note("c", 1),
      note("d", 3),
      note("e", 1),
    ]);
    expect([...grouped.keys()]).toEqual([1, 0, 3]);
    expect(grouped.get(1)!.map((n) => n.id)).toEqual(["a", "c", "e"]);
    expect(grouped.get(0)!.map((n) => n.id)).toEqual(["b"]);
  });

  it("is empty for no notes and does not mutate its input", () => {
    expect(notesByChapter([]).size).toBe(0);
    const input = [note("a", 0), note("b", 0)];
    notesByChapter(input);
    expect(input.map((n) => n.id)).toEqual(["a", "b"]);
  });
});
