// Write-through annotation writer. The Supabase helpers and the outbox enqueues are
// mocked, so each test asserts which path a write took: the direct call, the outbox
// enqueue, or nothing. `classifyWriteFailure` is the real one, so the transport /
// rejection split is the one the outbox uses.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAnnotationWriter } from "./annotation-writer";
import type { QueuedEntry } from "@/lib/offline/outbox";
import type { Annotation } from "@/lib/types";

const h = vi.hoisted(() => ({
  createAnnotation: vi.fn(),
  updateAnnotationNote: vi.fn(),
  deleteAnnotation: vi.fn(),
  enqueueAnnotationCreate: vi.fn(async () => {}),
  enqueueAnnotationNote: vi.fn(async () => {}),
  enqueueAnnotationDelete: vi.fn(async () => {}),
  pendingAnnotationEntries: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock("@/lib/db/annotations", () => ({
  createAnnotation: h.createAnnotation,
  updateAnnotationNote: h.updateAnnotationNote,
  deleteAnnotation: h.deleteAnnotation,
}));

vi.mock("@/lib/offline/outbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/outbox")>()),
  enqueueAnnotationCreate: h.enqueueAnnotationCreate,
  enqueueAnnotationNote: h.enqueueAnnotationNote,
  enqueueAnnotationDelete: h.enqueueAnnotationDelete,
  pendingAnnotationEntries: h.pendingAnnotationEntries,
}));

const CLIENT = { tag: "client" } as unknown as SupabaseClient;

const ANN: Annotation = {
  id: "a1",
  user_id: "u1",
  book_id: "book-1",
  kind: "page",
  cfi: "epubcfi(/6/4!/4/2)",
  quote: null,
  note: null,
  label: "Chapter One",
  percent: 0.25,
  created_at: "2026-10-17T10:00:00.000Z",
  updated_at: "2026-10-17T10:00:00.000Z",
};

const CREATE_INPUT = {
  id: "a1",
  bookId: "book-1",
  kind: "page",
  cfi: "epubcfi(/6/4!/4/2)",
  quote: null,
  note: null,
  label: "Chapter One",
  percent: 0.25,
};

/** A transport failure: no structured `code`, like a dropped connection. */
const TRANSPORT = new TypeError("Failed to fetch");
/** A rejection: the server answered, RLS refused. Carries a Postgres `code`. */
const REJECTED = Object.assign(new Error("new row violates row-level security policy"), {
  code: "42501",
});

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function queuedCreate(id: string): QueuedEntry {
  return { id: "1", kind: "annotation-create", key: `u1:${id}`, payload: {}, ts: 0 };
}

function makeWriter(isOnline = () => true) {
  return createAnnotationWriter({ userId: "u1", client: CLIENT, isOnline });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.createAnnotation.mockReset().mockResolvedValue(ANN);
  h.updateAnnotationNote.mockReset().mockResolvedValue(undefined);
  h.deleteAnnotation.mockReset().mockResolvedValue(undefined);
  h.pendingAnnotationEntries.mockReset().mockResolvedValue([]);
});

describe("createAnnotationWriter — direct write first", () => {
  it("online create calls createAnnotation directly and enqueues nothing", async () => {
    await makeWriter().create(ANN);

    expect(h.createAnnotation).toHaveBeenCalledWith(
      { userId: "u1", ...CREATE_INPUT },
      CLIENT,
    );
    expect(h.enqueueAnnotationCreate).not.toHaveBeenCalled();
  });

  it("a transport failure on create hands the write to the outbox", async () => {
    h.createAnnotation.mockRejectedValueOnce(TRANSPORT);

    await makeWriter().create(ANN);

    expect(h.enqueueAnnotationCreate).toHaveBeenCalledWith("u1", CREATE_INPUT);
  });

  it("offline create enqueues without touching the network", async () => {
    await makeWriter(() => false).create(ANN);

    expect(h.createAnnotation).not.toHaveBeenCalled();
    expect(h.enqueueAnnotationCreate).toHaveBeenCalledWith("u1", CREATE_INPUT);
  });

  it("a permanent failure on create is swallowed: no throw, nothing queued", async () => {
    h.createAnnotation.mockRejectedValueOnce(REJECTED);

    await expect(makeWriter().create(ANN)).resolves.toBeUndefined();
    expect(h.enqueueAnnotationCreate).not.toHaveBeenCalled();
  });

  it("a note with no queued create writes directly and falls back on transport failure", async () => {
    const writer = makeWriter();
    await writer.setNote("a1", "hello");
    expect(h.updateAnnotationNote).toHaveBeenCalledWith("a1", "hello", CLIENT);
    expect(h.enqueueAnnotationNote).not.toHaveBeenCalled();

    h.updateAnnotationNote.mockRejectedValueOnce(TRANSPORT);
    await writer.setNote("a1", "again");
    expect(h.enqueueAnnotationNote).toHaveBeenCalledWith("u1", "a1", "again");
  });
});

describe("createAnnotationWriter — per-item serialization", () => {
  it("a note issued during an in-flight create waits, then updates directly (no loss)", async () => {
    const create = deferred<Annotation>();
    h.createAnnotation.mockReturnValueOnce(create.promise);
    const writer = makeWriter();

    void writer.create(ANN);
    void writer.setNote("a1", "after create");

    // The note must not reach the server before its row exists.
    await Promise.resolve();
    await Promise.resolve();
    expect(h.updateAnnotationNote).not.toHaveBeenCalled();

    create.resolve(ANN);
    await writer.settled("a1");

    expect(h.updateAnnotationNote).toHaveBeenCalledWith("a1", "after create", CLIENT);
    expect(h.enqueueAnnotationNote).not.toHaveBeenCalled();
  });

  it("a delete issued during an in-flight create waits, then deletes directly", async () => {
    const create = deferred<Annotation>();
    h.createAnnotation.mockReturnValueOnce(create.promise);
    const writer = makeWriter();

    void writer.create(ANN);
    void writer.remove("a1");

    await Promise.resolve();
    await Promise.resolve();
    expect(h.deleteAnnotation).not.toHaveBeenCalled();

    create.resolve(ANN);
    await writer.settled("a1");

    expect(h.deleteAnnotation).toHaveBeenCalledWith("a1", CLIENT);
    expect(h.enqueueAnnotationDelete).not.toHaveBeenCalled();
  });

  it("a failed create does not block later writes to the same id", async () => {
    h.createAnnotation.mockRejectedValueOnce(REJECTED);
    const writer = makeWriter();

    await writer.create(ANN);
    await writer.setNote("a1", "still written");

    expect(h.updateAnnotationNote).toHaveBeenCalledWith("a1", "still written", CLIENT);
  });

  it("settled resolves at once for an id with no writes", async () => {
    await expect(makeWriter().settled("never-written")).resolves.toBeUndefined();
  });
});

describe("createAnnotationWriter — note and delete when the create is queued", () => {
  it("a note with a queued create merges through enqueueAnnotationNote", async () => {
    h.pendingAnnotationEntries.mockResolvedValue([queuedCreate("a1")]);

    await makeWriter().setNote("a1", "queued note");

    expect(h.enqueueAnnotationNote).toHaveBeenCalledWith("u1", "a1", "queued note");
    expect(h.updateAnnotationNote).not.toHaveBeenCalled();
  });

  it("a delete with a queued create cancels it through enqueueAnnotationDelete", async () => {
    h.pendingAnnotationEntries.mockResolvedValue([queuedCreate("a1")]);

    await makeWriter().remove("a1");

    expect(h.enqueueAnnotationDelete).toHaveBeenCalledWith("u1", "a1");
    expect(h.deleteAnnotation).not.toHaveBeenCalled();
  });

  it("isPending is true while the outbox holds the create, false once it is gone", async () => {
    const writer = makeWriter();
    h.pendingAnnotationEntries.mockResolvedValue([queuedCreate("a1")]);
    await expect(writer.isPending("a1")).resolves.toBe(true);

    h.pendingAnnotationEntries.mockResolvedValue([]);
    await expect(writer.isPending("a1")).resolves.toBe(false);
  });
});
