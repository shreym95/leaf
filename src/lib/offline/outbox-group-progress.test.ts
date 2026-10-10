// The "group-progress" outbox kind end to end against fake-indexeddb: enqueue
// semantics (coalescing, latest intent wins) and the real replay handler, driven the
// way production drives it — the `online` event. The generic drain rules are in
// outbox.test.ts; this file is about this kind's wiring.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  setGroupProgress: vi.fn(async (..._a: unknown[]) => {}),
  getMyProgress: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
  setBookFinished: vi.fn(async (..._a: unknown[]) => {}),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({ marker: "browser-client" })),
}));
vi.mock("@/lib/db/groups", () => ({
  setGroupProgress: h.setGroupProgress,
  getMyProgress: h.getMyProgress,
}));
vi.mock("@/lib/db/book-status", () => ({ setBookFinished: h.setBookFinished }));

import {
  createIndexedDbStore,
  enqueueBookStatus,
  enqueueGroupProgress,
  purgeOutbox,
  type GroupProgressPayload,
} from "./outbox";

const store = createIndexedDbStore();

const base: GroupProgressPayload = {
  userId: "u1",
  readId: "r1",
  chapterIndex: 2,
  chapterFraction: 0.5,
  percent: 0.25,
  finishedAt: null,
};

async function queued() {
  return (await store.list()).filter((e) => e.kind === "group-progress");
}

/** Fire the `online` event and wait for the replay it starts to finish. */
async function replay() {
  const before = h.setGroupProgress.mock.calls.length + h.getMyProgress.mock.calls.length;
  window.dispatchEvent(new Event("online"));
  await vi.waitFor(() =>
    expect(
      h.setGroupProgress.mock.calls.length + h.getMyProgress.mock.calls.length,
    ).toBeGreaterThan(before),
  );
  // Let drain() finish discarding / leaving the entry.
  await new Promise((r) => setTimeout(r, 20));
}

beforeEach(async () => {
  vi.clearAllMocks();
  h.setGroupProgress.mockResolvedValue(undefined);
  h.getMyProgress.mockResolvedValue(null);
  h.setBookFinished.mockResolvedValue(undefined);
  globalThis.indexedDB = new IDBFactory();
  await purgeOutbox();
  globalThis.indexedDB = new IDBFactory();
});

describe("enqueueGroupProgress", () => {
  it("queues one entry keyed by read and user, with the payload to replay", async () => {
    await enqueueGroupProgress(base);

    const entries = await queued();
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("r1:u1");
    expect(entries[0].payload as GroupProgressPayload).toEqual(base);
  });

  it("coalesces: many positions for the same read leave one entry", async () => {
    await enqueueGroupProgress(base);
    await enqueueGroupProgress({ ...base, chapterIndex: 3 });
    await enqueueGroupProgress({ ...base, chapterIndex: 4 });
    expect(await queued()).toHaveLength(1);
  });

  it("the latest intent wins, including moving backwards and un-finishing", async () => {
    await enqueueGroupProgress({
      ...base,
      chapterIndex: 9,
      chapterFraction: 1,
      percent: 1,
      finishedAt: "2026-10-11T10:00:00.000Z",
    });
    await enqueueGroupProgress(base);

    const entries = await queued();
    expect(entries).toHaveLength(1);
    expect(entries[0].payload as GroupProgressPayload).toEqual(base);
  });

  it("keeps separate entries for different reads and different users", async () => {
    await enqueueGroupProgress(base);
    await enqueueGroupProgress({ ...base, readId: "r2" });
    await enqueueGroupProgress({ ...base, userId: "u2" });
    expect((await queued()).map((e) => e.key).sort()).toEqual(["r1:u1", "r1:u2", "r2:u1"]);
  });

  it("does not touch queued entries of another kind", async () => {
    await enqueueBookStatus("u1", "r1", "2026-10-02T10:00:00.000Z");
    await enqueueGroupProgress(base);
    await enqueueGroupProgress({ ...base, chapterIndex: 5 });

    const all = await store.list();
    expect(all.filter((e) => e.kind === "book-status")).toHaveLength(1);
    expect(all.filter((e) => e.kind === "group-progress")).toHaveLength(1);
  });
});

describe("group-progress replay", () => {
  it("applies the queued write through setGroupProgress, stamped with the time it was recorded", async () => {
    const before = Date.now();
    await enqueueGroupProgress(base);
    const [entry] = await queued();
    await replay();

    expect(h.setGroupProgress).toHaveBeenCalledTimes(1);
    const [payload, client, updatedAt] = h.setGroupProgress.mock.calls[0];
    expect(payload).toEqual(base);
    expect(client).toEqual({ marker: "browser-client" });
    expect(updatedAt).toBe(new Date(entry.ts).toISOString());
    expect(entry.ts).toBeGreaterThanOrEqual(before);
    expect(await queued()).toHaveLength(0);
  });

  it("replays only the latest coalesced position", async () => {
    await enqueueGroupProgress(base);
    await enqueueGroupProgress({ ...base, chapterIndex: 7, percent: 0.7 });
    await replay();

    expect(h.setGroupProgress).toHaveBeenCalledTimes(1);
    expect(h.setGroupProgress.mock.calls[0][0]).toMatchObject({
      chapterIndex: 7,
      percent: 0.7,
    });
  });

  it("a stale replay is harmless: a newer server row wins and the entry is discarded", async () => {
    await enqueueGroupProgress(base);
    h.getMyProgress.mockResolvedValue({
      read_id: "r1",
      user_id: "u1",
      chapter_index: 8,
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    });
    await replay();

    expect(h.setGroupProgress).not.toHaveBeenCalled();
    expect(await queued()).toHaveLength(0);
  });

  it("replays over an older server row", async () => {
    await enqueueGroupProgress(base);
    h.getMyProgress.mockResolvedValue({
      read_id: "r1",
      user_id: "u1",
      chapter_index: 1,
      updated_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await replay();

    expect(h.setGroupProgress).toHaveBeenCalledTimes(1);
    expect(await queued()).toHaveLength(0);
  });

  it("is retried, not dropped, on a transport failure of the write", async () => {
    h.setGroupProgress.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await enqueueGroupProgress(base);
    await replay();

    expect(await queued()).toHaveLength(1);

    // Back online: the same entry is replayed and cleared.
    await replay();
    expect(h.setGroupProgress).toHaveBeenCalledTimes(2);
    expect(await queued()).toHaveLength(0);
  });

  it("is retried, not dropped, on a transport failure of the staleness check", async () => {
    h.getMyProgress.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await enqueueGroupProgress(base);
    await replay();

    expect(h.setGroupProgress).not.toHaveBeenCalled();
    expect(await queued()).toHaveLength(1);
  });

  it("drops the entry when the server rejects it (RLS, bad data)", async () => {
    h.setGroupProgress.mockRejectedValueOnce({ code: "42501", message: "denied" });
    await enqueueGroupProgress(base);
    await replay();

    expect(await queued()).toHaveLength(0);
  });

  it("leaves other kinds working: a book-status entry still replays through its own handler", async () => {
    await enqueueBookStatus("u1", "b1", "2026-10-02T10:00:00.000Z");
    await enqueueGroupProgress(base);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => {
      expect(h.setBookFinished).toHaveBeenCalledTimes(1);
      expect(h.setGroupProgress).toHaveBeenCalledTimes(1);
    });
    expect(h.setBookFinished).toHaveBeenCalledWith(
      "u1",
      "b1",
      "2026-10-02T10:00:00.000Z",
      expect.anything(),
    );
  });
});
