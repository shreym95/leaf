// The "book-status" outbox kind end to end against fake-indexeddb: enqueue
// semantics (latest intent wins) and the real replay handler, driven the way
// production drives it — the `online` event. The generic drain rules are in
// outbox.test.ts; this file is about this kind's wiring.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  setBookFinished: vi.fn(async (..._a: unknown[]) => {}),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({ marker: "browser-client" })),
}));
vi.mock("@/lib/db/book-status", () => ({ setBookFinished: h.setBookFinished }));

import {
  createIndexedDbStore,
  enqueueBookStatus,
  purgeOutbox,
  type BookStatusPayload,
} from "./outbox";

const store = createIndexedDbStore();

async function queued() {
  return (await store.list()).filter((e) => e.kind === "book-status");
}

/** Fire the `online` event and wait for the replay it starts to finish. */
async function replay() {
  const before = h.setBookFinished.mock.calls.length;
  window.dispatchEvent(new Event("online"));
  await vi.waitFor(() =>
    expect(h.setBookFinished.mock.calls.length).toBeGreaterThan(before),
  );
  // Let drain() finish discarding / leaving the entry.
  await new Promise((r) => setTimeout(r, 20));
}

beforeEach(async () => {
  vi.clearAllMocks();
  h.setBookFinished.mockResolvedValue(undefined);
  globalThis.indexedDB = new IDBFactory();
  await purgeOutbox();
  globalThis.indexedDB = new IDBFactory();
});

describe("enqueueBookStatus", () => {
  it("queues one entry keyed by user and book, with the payload to replay", async () => {
    await enqueueBookStatus("u1", "b1", "2026-10-02T10:00:00.000Z");

    const entries = await queued();
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("u1:b1");
    expect(entries[0].payload as BookStatusPayload).toEqual({
      userId: "u1",
      bookId: "b1",
      finishedAt: "2026-10-02T10:00:00.000Z",
    });
  });

  it("the latest intent wins: finish then un-finish leaves only the un-finish", async () => {
    await enqueueBookStatus("u1", "b1", "2026-10-02T10:00:00.000Z");
    await enqueueBookStatus("u1", "b1", null);

    const entries = await queued();
    expect(entries).toHaveLength(1);
    expect((entries[0].payload as BookStatusPayload).finishedAt).toBeNull();
  });

  it("keeps separate entries for different books", async () => {
    await enqueueBookStatus("u1", "b1", "2026-10-02T10:00:00.000Z");
    await enqueueBookStatus("u1", "b2", "2026-10-02T11:00:00.000Z");
    expect(await queued()).toHaveLength(2);
  });
});

describe("book-status replay", () => {
  it("applies the queued write through setBookFinished and discards it", async () => {
    await enqueueBookStatus("u1", "b1", "2026-10-02T10:00:00.000Z");
    await replay();

    expect(h.setBookFinished).toHaveBeenCalledWith(
      "u1",
      "b1",
      "2026-10-02T10:00:00.000Z",
      { marker: "browser-client" },
    );
    expect(await queued()).toHaveLength(0);
  });

  it("replays an un-finish with null", async () => {
    await enqueueBookStatus("u1", "b1", null);
    await replay();
    expect(h.setBookFinished).toHaveBeenCalledWith("u1", "b1", null, expect.anything());
  });

  it("leaves the entry queued on a transport failure", async () => {
    h.setBookFinished.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await enqueueBookStatus("u1", "b1", "2026-10-02T10:00:00.000Z");
    await replay();

    expect(await queued()).toHaveLength(1);
  });

  it("drops the entry when the server rejects it (RLS, bad data)", async () => {
    h.setBookFinished.mockRejectedValueOnce({ code: "42501", message: "denied" });
    await enqueueBookStatus("u1", "b1", "2026-10-02T10:00:00.000Z");
    await replay();

    expect(await queued()).toHaveLength(0);
  });
});
