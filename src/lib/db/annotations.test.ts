// `annotations` db wrappers (0012) — assert the query shape: table, book filter,
// insert payload (id kept when supplied, nulls defaulted), note and quote checks
// before the round trip, and delete / update scoping. A hand-rolled fake Supabase
// client records the calls.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ANNOTATION_NOTE_MAX,
  ANNOTATION_QUOTE_MAX,
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
  updateAnnotationNote,
} from "./annotations";
import type { Annotation } from "@/lib/types";

const ROW: Annotation = {
  id: "an-1",
  user_id: "u1",
  book_id: "book1",
  kind: "page",
  cfi: "epubcfi(/6/14!/4/2/1:0)",
  quote: null,
  note: null,
  label: "Chapter 1",
  percent: 0.25,
  created_at: "2026-10-17T00:00:00Z",
  updated_at: "2026-10-17T00:00:00Z",
};

const RANGE_ROW: Annotation = {
  ...ROW,
  id: "an-2",
  kind: "range",
  cfi: "epubcfi(/6/14!/4/2,/1:0,/1:9)",
  quote: "a quoted line",
};

function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: Record<string, unknown> = { eq: [] };
  const rec = (key: string, args: unknown[]) => {
    if (key === "eq") {
      (calls.eq as unknown[]).push(args);
    } else {
      calls[key] = args;
    }
  };
  const builder = {
    select: (...a: unknown[]) => (rec("select", a), builder),
    insert: (...a: unknown[]) => (rec("insert", a), builder),
    update: (...a: unknown[]) => (rec("update", a), builder),
    delete: (...a: unknown[]) => (rec("delete", a), builder),
    eq: (...a: unknown[]) => (rec("eq", a), builder),
    order: (...a: unknown[]) => (rec("order", a), builder),
    single: () => Promise.resolve(result),
    then: (fn: (r: typeof result) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(fn, rej),
  };
  const from = vi.fn((table: string) => ((calls.from = table), builder));
  return { client: { from } as unknown as SupabaseClient, calls, from };
}

describe("listAnnotations", () => {
  it("reads the annotations table scoped to the book, oldest first", async () => {
    const { client, calls } = fakeClient({ data: [ROW, RANGE_ROW], error: null });
    const out = await listAnnotations("book1", client);

    expect(calls.from).toBe("annotations");
    expect(calls.eq).toEqual([["book_id", "book1"]]);
    expect(calls.order).toEqual(["created_at", { ascending: true }]);
    expect(out).toEqual([ROW, RANGE_ROW]);
  });

  it("returns [] when the table is empty", async () => {
    const { client } = fakeClient({ data: null, error: null });
    await expect(listAnnotations("book1", client)).resolves.toEqual([]);
  });

  it("throws on a db error", async () => {
    const { client } = fakeClient({ data: null, error: new Error("nope") });
    await expect(listAnnotations("book1", client)).rejects.toThrow("nope");
  });

  it("requires an explicit client", async () => {
    await expect(listAnnotations("book1")).rejects.toThrow(/explicit Supabase client/);
  });
});

describe("createAnnotation", () => {
  it("inserts a page with the owner, book, cfi and denormalised label / percent", async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null });
    const out = await createAnnotation(
      {
        userId: "u1",
        bookId: "book1",
        kind: "page",
        cfi: ROW.cfi,
        label: "Chapter 1",
        percent: 0.25,
      },
      client,
    );

    expect(calls.from).toBe("annotations");
    expect(calls.insert).toEqual([
      {
        user_id: "u1",
        book_id: "book1",
        kind: "page",
        cfi: ROW.cfi,
        quote: null,
        note: null,
        label: "Chapter 1",
        percent: 0.25,
      },
    ]);
    expect(calls.select).toEqual(["*"]);
    expect(out).toEqual(ROW);
  });

  it("keeps a client-supplied id so an outbox replay reuses it", async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null });
    await createAnnotation(
      { id: "an-1", userId: "u1", bookId: "book1", kind: "page", cfi: ROW.cfi },
      client,
    );

    expect(calls.insert).toEqual([
      expect.objectContaining({ id: "an-1", user_id: "u1" }),
    ]);
  });

  it("omits id when none is supplied, so the database generates it", async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null });
    await createAnnotation({ userId: "u1", bookId: "book1", kind: "page", cfi: ROW.cfi }, client);

    const payload = (calls.insert as unknown[])[0] as Record<string, unknown>;
    expect("id" in payload).toBe(false);
  });

  it("defaults quote, note, label and percent to null when omitted", async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null });
    await createAnnotation({ userId: "u1", bookId: "book1", kind: "page", cfi: ROW.cfi }, client);

    expect(calls.insert).toEqual([
      {
        user_id: "u1",
        book_id: "book1",
        kind: "page",
        cfi: ROW.cfi,
        quote: null,
        note: null,
        label: null,
        percent: null,
      },
    ]);
  });

  it("inserts a range with its quote and an optional note", async () => {
    const { client, calls } = fakeClient({ data: RANGE_ROW, error: null });
    await createAnnotation(
      {
        userId: "u1",
        bookId: "book1",
        kind: "range",
        cfi: RANGE_ROW.cfi,
        quote: "a quoted line",
        note: "keep this",
      },
      client,
    );

    expect(calls.insert).toEqual([
      expect.objectContaining({ kind: "range", quote: "a quoted line", note: "keep this" }),
    ]);
  });

  it("refuses a range without a quote before any round trip", async () => {
    const { client, from } = fakeClient({ data: ROW, error: null });
    await expect(
      createAnnotation({ userId: "u1", bookId: "book1", kind: "range", cfi: RANGE_ROW.cfi }, client),
    ).rejects.toThrow(/needs a quote/);
    await expect(
      createAnnotation(
        { userId: "u1", bookId: "book1", kind: "range", cfi: RANGE_ROW.cfi, quote: "" },
        client,
      ),
    ).rejects.toThrow(/needs a quote/);
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses a page that carries a quote", async () => {
    const { client, from } = fakeClient({ data: ROW, error: null });
    await expect(
      createAnnotation(
        { userId: "u1", bookId: "book1", kind: "page", cfi: ROW.cfi, quote: "text" },
        client,
      ),
    ).rejects.toThrow(/carries no quote/);
    expect(from).not.toHaveBeenCalled();
  });

  it("accepts a quote of exactly 5000 characters and refuses 5001", async () => {
    const { client } = fakeClient({ data: RANGE_ROW, error: null });
    const base = { userId: "u1", bookId: "book1", kind: "range" as const, cfi: RANGE_ROW.cfi };

    await expect(
      createAnnotation({ ...base, quote: "q".repeat(ANNOTATION_QUOTE_MAX) }, client),
    ).resolves.toEqual(RANGE_ROW);
    await expect(
      createAnnotation({ ...base, quote: "q".repeat(ANNOTATION_QUOTE_MAX + 1) }, client),
    ).rejects.toThrow(/at most 5000/);
  });

  it("accepts a note of 500 characters and refuses 0 and 501", async () => {
    const { client } = fakeClient({ data: ROW, error: null });
    const base = { userId: "u1", bookId: "book1", kind: "page" as const, cfi: ROW.cfi };

    await expect(
      createAnnotation({ ...base, note: "n".repeat(ANNOTATION_NOTE_MAX) }, client),
    ).resolves.toEqual(ROW);
    await expect(createAnnotation({ ...base, note: "" }, client)).rejects.toThrow(/1–500/);
    await expect(
      createAnnotation({ ...base, note: "n".repeat(ANNOTATION_NOTE_MAX + 1) }, client),
    ).rejects.toThrow(/1–500/);
  });

  it("counts a note in characters, not UTF-16 units", async () => {
    const { client } = fakeClient({ data: ROW, error: null });
    // 500 emoji are 1000 UTF-16 units but 500 characters: accepted.
    const emoji = "😀".repeat(ANNOTATION_NOTE_MAX);
    await expect(
      createAnnotation({ userId: "u1", bookId: "book1", kind: "page", cfi: ROW.cfi, note: emoji }, client),
    ).resolves.toEqual(ROW);
  });

  it("throws on a db error", async () => {
    const { client } = fakeClient({ data: null, error: new Error("denied") });
    await expect(
      createAnnotation({ userId: "u1", bookId: "book1", kind: "page", cfi: ROW.cfi }, client),
    ).rejects.toThrow("denied");
  });

  it("requires an explicit client", async () => {
    await expect(
      createAnnotation({ userId: "u1", bookId: "book1", kind: "page", cfi: ROW.cfi }),
    ).rejects.toThrow(/explicit Supabase client/);
  });
});

describe("updateAnnotationNote", () => {
  it("sets the note on one annotation by id", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await updateAnnotationNote("an-1", "Watch the sea", client);

    expect(calls.from).toBe("annotations");
    expect(calls.update).toEqual([{ note: "Watch the sea" }]);
    expect(calls.eq).toEqual([["id", "an-1"]]);
  });

  it("clears the note with null", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await updateAnnotationNote("an-1", null, client);

    expect(calls.update).toEqual([{ note: null }]);
  });

  it("refuses an empty or over-long note before any round trip", async () => {
    const { client, from } = fakeClient({ data: null, error: null });
    await expect(updateAnnotationNote("an-1", "", client)).rejects.toThrow(/1–500/);
    await expect(
      updateAnnotationNote("an-1", "n".repeat(ANNOTATION_NOTE_MAX + 1), client),
    ).rejects.toThrow(/1–500/);
    expect(from).not.toHaveBeenCalled();
  });

  it("throws on a db error", async () => {
    const { client } = fakeClient({ data: null, error: new Error("denied") });
    await expect(updateAnnotationNote("an-1", "x", client)).rejects.toThrow("denied");
  });

  it("requires an explicit client", async () => {
    await expect(updateAnnotationNote("an-1", "x")).rejects.toThrow(/explicit Supabase client/);
  });
});

describe("deleteAnnotation", () => {
  it("deletes by id", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await deleteAnnotation("an-1", client);

    expect(calls.from).toBe("annotations");
    expect(calls.delete).toEqual([]);
    expect(calls.eq).toEqual([["id", "an-1"]]);
  });

  it("throws on a db error", async () => {
    const { client } = fakeClient({ data: null, error: new Error("denied") });
    await expect(deleteAnnotation("an-1", client)).rejects.toThrow("denied");
  });

  it("requires an explicit client", async () => {
    await expect(deleteAnnotation("an-1")).rejects.toThrow(/explicit Supabase client/);
  });
});
