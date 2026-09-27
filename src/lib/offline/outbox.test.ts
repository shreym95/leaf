// Outbox queue/replay logic (§8, D8). jsdom has no IndexedDB and this repo
// cannot add `fake-indexeddb` (another agent owns `package.json`), so this
// file drives the storage-agnostic engine (`drain`, `isFurtherAlong`,
// `classifyWriteFailure`, `cancelPending`) against a hand-written in-memory
// `OutboxStore` — never real IndexedDB.
//
// NOT covered here (needs a real browser): `createIndexedDbStore` itself
// (actual `indexedDB.open`/transactions), and `initOutboxReplay`'s wiring of
// the `online` event listener. Those are thin, mechanical wrappers around
// this tested core — see the final report for exactly what would need a
// browser or device to confirm end-to-end.

import { beforeEach, describe, expect, it } from "vitest";
import {
  cancelPending,
  classifyWriteFailure,
  drain,
  isFurtherAlong,
  type OutboxStore,
  type QueuedEntry,
  type ReplayHandler,
} from "./outbox";

/** A minimal, faithful in-memory stand-in for the real IndexedDB store:
 *  append-only, returns entries in insertion order, discard by id. */
function makeMemoryStore(): OutboxStore & { size(): number } {
  let entries: QueuedEntry[] = [];
  let seq = 0;
  return {
    async enqueue(entry) {
      const id = `e${seq++}`;
      entries.push({ ...entry, id });
      return id;
    },
    async list() {
      return [...entries];
    },
    async discard(id) {
      entries = entries.filter((e) => e.id !== id);
    },
    size() {
      return entries.length;
    },
  };
}

describe("isFurtherAlong (§8b conflict rule)", () => {
  it("applies when there is no current row yet", () => {
    expect(isFurtherAlong(null, { percent: 0.1, updatedAt: "2026-01-01T00:00:00Z" })).toBe(
      true,
    );
  });

  it("applies a queued write that is further along than the current row", () => {
    const current = { percent: 0.3, updatedAt: "2026-01-01T00:00:00Z" };
    const queued = { percent: 0.5, updatedAt: "2026-01-01T00:00:01Z" };
    expect(isFurtherAlong(current, queued)).toBe(true);
  });

  it("REJECTS a stale queued write that would drag the reader backwards", () => {
    // The scenario §8(b) exists for: a write queued an hour ago on a device
    // that has since read further must not win once it finally replays.
    const current = { percent: 0.8, updatedAt: "2026-01-01T01:00:00Z" };
    const queued = { percent: 0.3, updatedAt: "2026-01-01T00:00:00Z" };
    expect(isFurtherAlong(current, queued)).toBe(false);
  });

  it("breaks an exact percent tie on updated_at (newer wins)", () => {
    const current = { percent: 0.5, updatedAt: "2026-01-01T00:00:00Z" };
    expect(
      isFurtherAlong(current, { percent: 0.5, updatedAt: "2026-01-01T00:00:01Z" }),
    ).toBe(true);
    expect(
      isFurtherAlong(current, { percent: 0.5, updatedAt: "2025-12-31T23:59:59Z" }),
    ).toBe(false);
  });
});

describe("classifyWriteFailure", () => {
  it("treats a structured Postgrest/Postgres error (has `code`) as a rejection", () => {
    expect(classifyWriteFailure({ code: "42501", message: "permission denied" })).toBe(
      "rejected",
    );
  });

  it("treats a missing-config error as a rejection (nothing to ever replay against)", () => {
    expect(classifyWriteFailure({ name: "SupabaseNotConfiguredError" })).toBe("rejected");
  });

  it("treats a bare fetch/TypeError with no `code` as a transport failure", () => {
    expect(classifyWriteFailure(new TypeError("Failed to fetch"))).toBe("transport");
  });

  it("treats an unrecognisable thrown value as a transport failure (be conservative)", () => {
    expect(classifyWriteFailure("boom")).toBe("transport");
    expect(classifyWriteFailure(undefined)).toBe("transport");
  });
});

describe("drain — enqueue/replay ordering", () => {
  it("replays entries in FIFO (insertion) order", async () => {
    const store = makeMemoryStore();
    await store.enqueue({ kind: "bookmark-create", key: "k1", payload: { n: 1 }, ts: 1 });
    await store.enqueue({ kind: "bookmark-create", key: "k2", payload: { n: 2 }, ts: 2 });
    await store.enqueue({ kind: "bookmark-create", key: "k3", payload: { n: 3 }, ts: 3 });

    const seen: number[] = [];
    const handler: ReplayHandler = async (entry) => {
      seen.push((entry.payload as { n: number }).n);
      return "applied";
    };

    await drain(store, { "bookmark-create": handler });

    expect(seen).toEqual([1, 2, 3]);
    expect(store.size()).toBe(0); // every applied entry is discarded
  });

  it("leaves an entry queued when there is no handler for its kind (forward-compat)", async () => {
    const store = makeMemoryStore();
    await store.enqueue({ kind: "highlight-note", key: "k1", payload: {}, ts: 1 });

    const result = await drain(store, {});

    expect(result).toEqual({ applied: 0, skipped: 0, rejected: 0, requeued: 0 });
    expect(store.size()).toBe(1);
  });
});

describe("drain — transport requeues, rejection discards", () => {
  it("re-queues an entry whose handler reports a transport failure", async () => {
    const store = makeMemoryStore();
    await store.enqueue({ kind: "reading-state", key: "b1", payload: {}, ts: 1 });

    const handler: ReplayHandler = async () => "transport";
    const result = await drain(store, { "reading-state": handler });

    expect(result.requeued).toBe(1);
    expect(store.size()).toBe(1); // still there for the next replay attempt
  });

  it("discards an entry whose handler reports a rejection (RLS — not yours / gone)", async () => {
    const store = makeMemoryStore();
    await store.enqueue({ kind: "bookmark-delete", key: "b1", payload: {}, ts: 1 });

    const handler: ReplayHandler = async () => "rejected";
    const result = await drain(store, { "bookmark-delete": handler });

    expect(result.rejected).toBe(1);
    expect(store.size()).toBe(0); // gone — not retried forever
  });

  it("treats a handler that throws unexpectedly as transport (conservative retry)", async () => {
    const store = makeMemoryStore();
    await store.enqueue({ kind: "highlight-create", key: "h1", payload: {}, ts: 1 });

    const handler: ReplayHandler = async () => {
      throw new Error("unexpected");
    };
    const result = await drain(store, { "highlight-create": handler });

    expect(result.requeued).toBe(1);
    expect(store.size()).toBe(1);
  });

  it("a delete whose row is already gone counts as success, not failure", async () => {
    // The real `deleteBookmark`/`deleteHighlight` wrappers don't error when
    // nothing matches — Postgrest resolves with 0 rows affected, no `error`.
    // A handler modelling that resolves "applied" (or "skipped"); either way
    // the entry is discarded, never retried.
    const store = makeMemoryStore();
    await store.enqueue({ kind: "highlight-delete", key: "h1", payload: {}, ts: 1 });

    const handler: ReplayHandler = async () => "applied"; // row already gone; no error thrown
    const result = await drain(store, { "highlight-delete": handler });

    expect(result.applied).toBe(1);
    expect(store.size()).toBe(0);
  });
});

describe("drain — furthest-position-wins end to end", () => {
  function makeReadingStateHandler(current: { percent: number; updatedAt: string } | null) {
    const handler: ReplayHandler = async (entry) => {
      const queued = entry.payload as { percent: number; updatedAt: string };
      if (current && !isFurtherAlong(current, queued)) return "skipped";
      return "applied";
    };
    return handler;
  }

  it("does NOT overwrite a further position with a stale queued write", async () => {
    const store = makeMemoryStore();
    // Queued an hour ago at 30%; the device has since read to 80%.
    await store.enqueue({
      kind: "reading-state",
      key: "u1:book1",
      payload: { percent: 0.3, updatedAt: "2026-01-01T00:00:00Z" },
      ts: 1,
    });

    const applies: number[] = [];
    const handler: ReplayHandler = async (entry) => {
      const queued = entry.payload as { percent: number; updatedAt: string };
      const current = { percent: 0.8, updatedAt: "2026-01-01T01:00:00Z" };
      if (!isFurtherAlong(current, queued)) return "skipped";
      applies.push(queued.percent);
      return "applied";
    };

    const result = await drain(store, { "reading-state": handler });

    expect(applies).toEqual([]); // never applied
    expect(result.skipped).toBe(1);
    expect(store.size()).toBe(0); // still discarded — correctly-skipped is success
  });

  it("DOES apply a queued write that is further along than the current row", async () => {
    const store = makeMemoryStore();
    await store.enqueue({
      kind: "reading-state",
      key: "u1:book1",
      payload: { percent: 0.6, updatedAt: "2026-01-01T02:00:00Z" },
      ts: 1,
    });

    const handler = makeReadingStateHandler({
      percent: 0.4,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const result = await drain(store, { "reading-state": handler });

    expect(result.applied).toBe(1);
    expect(store.size()).toBe(0);
  });

  it("applies when there is no current row at all (first sync)", async () => {
    const store = makeMemoryStore();
    await store.enqueue({
      kind: "reading-state",
      key: "u1:book1",
      payload: { percent: 0.1, updatedAt: "2026-01-01T00:00:00Z" },
      ts: 1,
    });

    const handler = makeReadingStateHandler(null);
    const result = await drain(store, { "reading-state": handler });

    expect(result.applied).toBe(1);
  });
});

describe("cancelPending", () => {
  it("cancels a still-queued entry by kind + key and reports it was found", async () => {
    const store = makeMemoryStore();
    await store.enqueue({
      kind: "bookmark-create",
      key: "u1:local-abc",
      payload: {},
      ts: 1,
    });

    const found = await cancelPending(store, "bookmark-create", "u1:local-abc");

    expect(found).toBe(true);
    expect(store.size()).toBe(0);
  });

  it("reports false when nothing matches, and leaves other entries alone", async () => {
    const store = makeMemoryStore();
    await store.enqueue({ kind: "bookmark-create", key: "u1:local-xyz", payload: {}, ts: 1 });

    const found = await cancelPending(store, "bookmark-create", "u1:local-abc");

    expect(found).toBe(false);
    expect(store.size()).toBe(1);
  });
});

describe("multiple entries, independent kinds and keys", () => {
  let store: ReturnType<typeof makeMemoryStore>;
  beforeEach(() => {
    store = makeMemoryStore();
  });

  it("drains each kind through its own handler independently", async () => {
    await store.enqueue({ kind: "bookmark-create", key: "a", payload: { t: "bm" }, ts: 1 });
    await store.enqueue({ kind: "highlight-create", key: "b", payload: { t: "hl" }, ts: 2 });

    const seenKinds: string[] = [];
    const result = await drain(store, {
      "bookmark-create": async (e) => {
        seenKinds.push(e.kind);
        return "applied";
      },
      "highlight-create": async (e) => {
        seenKinds.push(e.kind);
        return "applied";
      },
    });

    expect(seenKinds).toEqual(["bookmark-create", "highlight-create"]);
    expect(result.applied).toBe(2);
  });
});
