// The annotation outbox kinds end to end against fake-indexeddb: enqueue
// semantics (coalescing, the lost-note merge, delete cancelling a never-synced
// create), the real replay handlers driven by the `online` event, and the
// replay shims for legacy bookmark/highlight entries. The generic drain rules
// live in outbox.test.ts; this file is about these kinds' wiring.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createAnnotation: vi.fn(async (..._a: unknown[]) => ({})),
  updateAnnotationNote: vi.fn(async (..._a: unknown[]) => {}),
  deleteAnnotation: vi.fn(async (..._a: unknown[]) => {}),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({ marker: "browser-client" })),
}));
vi.mock("@/lib/db/annotations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/annotations")>()),
  createAnnotation: h.createAnnotation,
  updateAnnotationNote: h.updateAnnotationNote,
  deleteAnnotation: h.deleteAnnotation,
}));

import {
  createIndexedDbStore,
  enqueueAnnotationCreate,
  enqueueAnnotationDelete,
  enqueueAnnotationNote,
  purgeOutbox,
  type AnnotationCreatePayload,
  type QueuedEntry,
} from "./outbox";

const store = createIndexedDbStore();
const CLIENT = { marker: "browser-client" };

const ID = "3f2c9d1e-8a4b-4c6d-9e0f-1a2b3c4d5e6f";
const ID2 = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

async function queued(kind?: string): Promise<QueuedEntry[]> {
  const all = await store.list();
  return kind ? all.filter((e) => e.kind === kind) : all;
}

/** Fire the `online` event and wait for the replay it starts to finish. */
async function replay(calls: () => number, before: number) {
  window.dispatchEvent(new Event("online"));
  await vi.waitFor(() => expect(calls()).toBeGreaterThan(before));
  // Let drain() finish discarding / leaving the entry.
  await new Promise((r) => setTimeout(r, 20));
}

const createInput = {
  id: ID,
  bookId: "book-1",
  kind: "range" as const,
  cfi: "epubcfi(/6/4!/4/2,/1:0,/1:9)",
  quote: "a quoted line",
};

beforeEach(async () => {
  vi.clearAllMocks();
  h.createAnnotation.mockResolvedValue({});
  h.updateAnnotationNote.mockResolvedValue(undefined);
  h.deleteAnnotation.mockResolvedValue(undefined);
  globalThis.indexedDB = new IDBFactory();
  await purgeOutbox();
  globalThis.indexedDB = new IDBFactory();
});

describe("enqueueAnnotationCreate", () => {
  it("queues the create keyed by user and the caller's id", async () => {
    await enqueueAnnotationCreate("u1", createInput);

    const entries = await queued("annotation-create");
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe(`u1:${ID}`);
    expect(entries[0].payload).toEqual({
      userId: "u1",
      id: ID,
      bookId: "book-1",
      kind: "range",
      cfi: "epubcfi(/6/4!/4/2,/1:0,/1:9)",
      quote: "a quoted line",
      note: null,
      label: null,
      percent: null,
    });
  });
});

describe("enqueueAnnotationNote", () => {
  it("coalesces on the item: the latest note wins", async () => {
    await enqueueAnnotationNote("u1", ID, "first");
    await enqueueAnnotationNote("u1", ID, "second");

    const entries = await queued("annotation-note");
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe(`u1:${ID}`);
    expect((entries[0].payload as { note: string }).note).toBe("second");
  });

  // Regression: without the merge, a note on an unsynced item is queued as a
  // separate `annotation-note` that replays before the row exists and is dropped.
  it("merges into a still-queued create instead of queuing a separate note", async () => {
    await enqueueAnnotationCreate("u1", createInput);
    await enqueueAnnotationNote("u1", ID, "written before sync");

    expect(await queued("annotation-note")).toHaveLength(0);
    const creates = await queued("annotation-create");
    expect(creates).toHaveLength(1);
    expect((creates[0].payload as AnnotationCreatePayload).note).toBe("written before sync");
  });

  it("the merged note reaches the server inside the create", async () => {
    const before = h.createAnnotation.mock.calls.length;
    await enqueueAnnotationCreate("u1", createInput);
    await enqueueAnnotationNote("u1", ID, "written before sync");
    await replay(() => h.createAnnotation.mock.calls.length, before);

    expect(h.createAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ id: ID, userId: "u1", note: "written before sync" }),
      CLIENT,
    );
    expect(await queued()).toHaveLength(0);
  });
});

describe("enqueueAnnotationDelete", () => {
  it("cancels a still-queued create and its note; queues no delete", async () => {
    await enqueueAnnotationCreate("u1", createInput);
    await enqueueAnnotationNote("u1", ID, "a note");
    await enqueueAnnotationDelete("u1", ID);

    expect(await queued()).toHaveLength(0);
  });

  it("on a synced item, drops a queued note and queues one delete", async () => {
    await enqueueAnnotationNote("u1", ID, "edited");
    await enqueueAnnotationDelete("u1", ID);
    await enqueueAnnotationDelete("u1", ID);

    expect((await queued()).map((e) => e.kind)).toEqual(["annotation-delete"]);
  });

  it("leaves other items' queued writes alone", async () => {
    await enqueueAnnotationCreate("u1", createInput);
    await enqueueAnnotationCreate("u1", { ...createInput, id: ID2 });
    await enqueueAnnotationDelete("u1", ID);

    const creates = await queued("annotation-create");
    expect(creates.map((e) => e.key)).toEqual([`u1:${ID2}`]);
  });
});

describe("annotation replay", () => {
  it("create replays through createAnnotation with the caller's id and is discarded", async () => {
    const before = h.createAnnotation.mock.calls.length;
    await enqueueAnnotationCreate("u1", createInput);
    await replay(() => h.createAnnotation.mock.calls.length, before);

    expect(h.createAnnotation).toHaveBeenCalledWith(
      {
        id: ID,
        userId: "u1",
        bookId: "book-1",
        kind: "range",
        cfi: "epubcfi(/6/4!/4/2,/1:0,/1:9)",
        quote: "a quoted line",
        note: null,
        label: null,
        percent: null,
      },
      CLIENT,
    );
    expect(await queued()).toHaveLength(0);
  });

  it("note replays through updateAnnotationNote", async () => {
    const before = h.updateAnnotationNote.mock.calls.length;
    await enqueueAnnotationNote("u1", ID, "a note");
    await replay(() => h.updateAnnotationNote.mock.calls.length, before);

    expect(h.updateAnnotationNote).toHaveBeenCalledWith(ID, "a note", CLIENT);
    expect(await queued()).toHaveLength(0);
  });

  it("delete replays through deleteAnnotation", async () => {
    const before = h.deleteAnnotation.mock.calls.length;
    await enqueueAnnotationDelete("u1", ID);
    await replay(() => h.deleteAnnotation.mock.calls.length, before);

    expect(h.deleteAnnotation).toHaveBeenCalledWith(ID, CLIENT);
    expect(await queued()).toHaveLength(0);
  });

  it("leaves the entry queued on a transport failure", async () => {
    h.createAnnotation.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const before = h.createAnnotation.mock.calls.length;
    await enqueueAnnotationCreate("u1", createInput);
    await replay(() => h.createAnnotation.mock.calls.length, before);

    expect(await queued("annotation-create")).toHaveLength(1);
  });

  it("drops the entry when the server rejects it (RLS, bad data)", async () => {
    h.createAnnotation.mockRejectedValueOnce({ code: "42501", message: "denied" });
    const before = h.createAnnotation.mock.calls.length;
    await enqueueAnnotationCreate("u1", createInput);
    await replay(() => h.createAnnotation.mock.calls.length, before);

    expect(await queued()).toHaveLength(0);
  });

  it("drops an entry that fails client-side validation instead of retrying forever", async () => {
    h.createAnnotation.mockRejectedValueOnce(new RangeError("annotation note must be 1–500 characters"));
    const before = h.createAnnotation.mock.calls.length;
    await enqueueAnnotationCreate("u1", createInput);
    await replay(() => h.createAnnotation.mock.calls.length, before);

    expect(await queued()).toHaveLength(0);
  });
});

describe("legacy replay shims", () => {
  async function queueLegacy(entry: Omit<QueuedEntry, "id">) {
    await store.enqueue(entry);
  }

  it("a legacy bookmark-create with a local- id replays as a page with a server-assigned id", async () => {
    const before = h.createAnnotation.mock.calls.length;
    await queueLegacy({
      kind: "bookmark-create",
      key: "u1:local-abc",
      payload: {
        userId: "u1",
        localId: "local-abc",
        bookId: "book-1",
        cfi: "epubcfi(/6/2!/4/10)",
        label: "Chapter 2",
        percent: 0.4,
      },
      ts: 1,
    });
    await replay(() => h.createAnnotation.mock.calls.length, before);

    expect(h.createAnnotation).toHaveBeenCalledWith(
      {
        id: undefined,
        userId: "u1",
        bookId: "book-1",
        kind: "page",
        cfi: "epubcfi(/6/2!/4/10)",
        label: "Chapter 2",
        percent: 0.4,
      },
      CLIENT,
    );
    expect(await queued()).toHaveLength(0);
  });

  it("a legacy bookmark-create whose id is already a UUID keeps that id", async () => {
    const before = h.createAnnotation.mock.calls.length;
    await queueLegacy({
      kind: "bookmark-create",
      key: `u1:${ID}`,
      payload: { userId: "u1", localId: ID, bookId: "book-1", cfi: "c", label: null, percent: null },
      ts: 1,
    });
    await replay(() => h.createAnnotation.mock.calls.length, before);

    expect(h.createAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ id: ID, kind: "page" }),
      CLIENT,
    );
  });

  it("a legacy highlight-create replays as a range whose quote is the text", async () => {
    const before = h.createAnnotation.mock.calls.length;
    await queueLegacy({
      kind: "highlight-create",
      key: `u1:${ID}`,
      payload: {
        userId: "u1",
        localId: ID,
        bookId: "book-1",
        cfiRange: "epubcfi(/6/4!/4/2,/1:0,/1:9)",
        text: "the old text",
        color: "copper",
      },
      ts: 1,
    });
    await replay(() => h.createAnnotation.mock.calls.length, before);

    expect(h.createAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ID,
        kind: "range",
        cfi: "epubcfi(/6/4!/4/2,/1:0,/1:9)",
        quote: "the old text",
      }),
      CLIENT,
    );
  });

  it("legacy bookmark-delete, highlight-delete and highlight-note replay into the annotations client", async () => {
    const del = h.deleteAnnotation.mock.calls.length;
    const note = h.updateAnnotationNote.mock.calls.length;
    await queueLegacy({ kind: "bookmark-delete", key: `u1:${ID}`, payload: { userId: "u1", id: ID }, ts: 1 });
    await queueLegacy({ kind: "highlight-delete", key: `u1:${ID2}`, payload: { userId: "u1", id: ID2 }, ts: 2 });
    await queueLegacy({ kind: "highlight-note", key: `u1:${ID2}`, payload: { userId: "u1", id: ID2, note: "old" }, ts: 3 });
    await replay(() => h.deleteAnnotation.mock.calls.length, del);
    await vi.waitFor(() => expect(h.updateAnnotationNote.mock.calls.length).toBeGreaterThan(note));

    expect(h.deleteAnnotation).toHaveBeenCalledWith(ID, CLIENT);
    expect(h.deleteAnnotation).toHaveBeenCalledWith(ID2, CLIENT);
    expect(h.updateAnnotationNote).toHaveBeenCalledWith(ID2, "old", CLIENT);
    expect(await queued()).toHaveLength(0);
  });
});
