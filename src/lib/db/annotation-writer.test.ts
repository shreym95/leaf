// Outbox-first annotation writer. The outbox functions are mocked, so each test asserts
// what the writer does with them: validate, enqueue, then flush (online only). The
// annotation network helpers are mocked too, to prove the writer never calls them.
// The real queue, with the network behind it, is exercised in
// `src/lib/offline/annotation-sync.test.ts`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAnnotationWriter, SETTLE_TIMEOUT_MS } from "./annotation-writer";
import type { Annotation } from "@/lib/types";

const h = vi.hoisted(() => ({
  createAnnotation: vi.fn(),
  updateAnnotationNote: vi.fn(),
  deleteAnnotation: vi.fn(),
  enqueueAnnotationCreate: vi.fn(async (..._a: unknown[]) => {}),
  enqueueAnnotationNote: vi.fn(async (..._a: unknown[]) => {}),
  enqueueAnnotationDelete: vi.fn(async (..._a: unknown[]) => {}),
  flushOutbox: vi.fn(async () => {}),
  flushIdle: vi.fn(async () => {}),
  pendingAnnotationEntries: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock("@/lib/db/annotations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/annotations")>()),
  createAnnotation: h.createAnnotation,
  updateAnnotationNote: h.updateAnnotationNote,
  deleteAnnotation: h.deleteAnnotation,
}));

vi.mock("@/lib/offline/outbox", () => ({
  enqueueAnnotationCreate: h.enqueueAnnotationCreate,
  enqueueAnnotationNote: h.enqueueAnnotationNote,
  enqueueAnnotationDelete: h.enqueueAnnotationDelete,
  flushOutbox: h.flushOutbox,
  flushIdle: h.flushIdle,
  pendingAnnotationEntries: h.pendingAnnotationEntries,
  classifyWriteFailure: vi.fn(() => "transport"),
}));

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

const RANGE: Annotation = {
  ...ANN,
  id: "r1",
  kind: "range",
  quote: "a quoted line",
  label: null,
  percent: null,
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

function queuedCreate(id: string) {
  return { id: "1", kind: "annotation-create", key: `u1:${id}`, payload: {}, ts: 0 };
}

function makeWriter(isOnline = () => true) {
  return createAnnotationWriter({ userId: "u1", isOnline });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.createAnnotation.mockReset();
  h.updateAnnotationNote.mockReset();
  h.deleteAnnotation.mockReset();
  h.enqueueAnnotationCreate.mockReset().mockResolvedValue(undefined);
  h.enqueueAnnotationNote.mockReset().mockResolvedValue(undefined);
  h.enqueueAnnotationDelete.mockReset().mockResolvedValue(undefined);
  h.flushOutbox.mockReset().mockResolvedValue(undefined);
  h.flushIdle.mockReset().mockResolvedValue(undefined);
  h.pendingAnnotationEntries.mockReset().mockResolvedValue([]);
});

describe("createAnnotationWriter — validation (synchronous, never enqueued)", () => {
  it("a note over 500 characters throws RangeError on setNote and enqueues nothing", () => {
    expect(() => makeWriter().setNote("a1", "x".repeat(501))).toThrow(RangeError);
    expect(h.enqueueAnnotationNote).not.toHaveBeenCalled();
    expect(h.flushOutbox).not.toHaveBeenCalled();
  });

  it("an empty note throws RangeError: clearing a note is null, not an empty string", () => {
    expect(() => makeWriter().setNote("a1", "")).toThrow(RangeError);
    expect(h.enqueueAnnotationNote).not.toHaveBeenCalled();
  });

  it("a range without a quote throws RangeError on create and enqueues nothing", () => {
    expect(() => makeWriter().create({ ...RANGE, quote: "" })).toThrow(RangeError);
    expect(h.enqueueAnnotationCreate).not.toHaveBeenCalled();
    expect(h.flushOutbox).not.toHaveBeenCalled();
  });

  it("a page carrying a quote throws RangeError on create and enqueues nothing", () => {
    expect(() => makeWriter().create({ ...ANN, quote: "not allowed" })).toThrow(RangeError);
    expect(h.enqueueAnnotationCreate).not.toHaveBeenCalled();
  });

  it("an invalid create with an over-long note throws RangeError and enqueues nothing", () => {
    expect(() => makeWriter().create({ ...ANN, note: "x".repeat(501) })).toThrow(RangeError);
    expect(h.enqueueAnnotationCreate).not.toHaveBeenCalled();
  });
});

describe("createAnnotationWriter — outbox first", () => {
  it("create enqueues the row, then flushes; the enqueue resolves before the flush starts", async () => {
    await makeWriter().create(ANN);

    expect(h.enqueueAnnotationCreate).toHaveBeenCalledWith("u1", CREATE_INPUT);
    expect(h.flushOutbox).toHaveBeenCalledTimes(1);
    expect(h.enqueueAnnotationCreate.mock.invocationCallOrder[0]).toBeLessThan(
      h.flushOutbox.mock.invocationCallOrder[0],
    );
  });

  it("setNote enqueues the note, then flushes", async () => {
    await makeWriter().setNote("a1", "hello");

    expect(h.enqueueAnnotationNote).toHaveBeenCalledWith("u1", "a1", "hello");
    expect(h.flushOutbox).toHaveBeenCalledTimes(1);
  });

  it("remove enqueues the delete, then flushes", async () => {
    await makeWriter().remove("a1");

    expect(h.enqueueAnnotationDelete).toHaveBeenCalledWith("u1", "a1");
    expect(h.flushOutbox).toHaveBeenCalledTimes(1);
  });

  it("offline, every write is enqueued and no flush is started", async () => {
    const writer = makeWriter(() => false);
    await writer.create(ANN);
    await writer.setNote("a1", "later");
    await writer.remove("a1");

    expect(h.enqueueAnnotationCreate).toHaveBeenCalledTimes(1);
    expect(h.enqueueAnnotationNote).toHaveBeenCalledTimes(1);
    expect(h.enqueueAnnotationDelete).toHaveBeenCalledTimes(1);
    expect(h.flushOutbox).not.toHaveBeenCalled();
  });

  it("never calls the annotation network helpers directly", async () => {
    const writer = makeWriter();
    await writer.create(ANN);
    await writer.setNote("a1", "hello");
    await writer.remove("a1");

    expect(h.createAnnotation).not.toHaveBeenCalled();
    expect(h.updateAnnotationNote).not.toHaveBeenCalled();
    expect(h.deleteAnnotation).not.toHaveBeenCalled();
  });
});

describe("createAnnotationWriter — settled and isPending", () => {
  it("settled resolves at once when nothing is queued for the id", async () => {
    await expect(makeWriter().settled("never-written")).resolves.toBeUndefined();
    expect(h.flushIdle).not.toHaveBeenCalled();
  });

  it("settled waits for the running flush when the id has queued writes", async () => {
    h.pendingAnnotationEntries.mockResolvedValue([queuedCreate("a1")]);
    const writer = makeWriter();

    let done = false;
    const waiting = writer.settled("a1").then(() => {
      done = true;
    });
    await waiting;

    expect(h.flushIdle).toHaveBeenCalledTimes(1);
    expect(done).toBe(true);
  });

  it("settled gives up after SETTLE_TIMEOUT_MS when a flush hangs", async () => {
    vi.useFakeTimers();
    try {
      h.pendingAnnotationEntries.mockResolvedValue([queuedCreate("a1")]);
      h.flushIdle.mockReturnValue(new Promise<void>(() => {}));

      let resolved = false;
      const p = makeWriter().settled("a1").then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(SETTLE_TIMEOUT_MS - 1);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("isPending is true while the outbox holds the create, false once it is gone", async () => {
    const writer = makeWriter();
    h.pendingAnnotationEntries.mockResolvedValue([queuedCreate("a1")]);
    await expect(writer.isPending("a1")).resolves.toBe(true);

    h.pendingAnnotationEntries.mockResolvedValue([]);
    await expect(writer.isPending("a1")).resolves.toBe(false);
  });

  it("isPending is false for a queued note, which is not a create", async () => {
    h.pendingAnnotationEntries.mockResolvedValue([
      { id: "2", kind: "annotation-note", key: "u1:a1", payload: {}, ts: 0 },
    ]);
    await expect(makeWriter().isPending("a1")).resolves.toBe(false);
  });
});
