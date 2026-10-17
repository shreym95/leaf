// The replay engine's ordering and single-flight rules, against an in-memory store
// that supports `put` (the real IndexedDB store does). No IndexedDB, no network.
// Covers: single-flight flush, revision-checked discard (B2), attempted-before-send,
// FIFO stop on transport failure, and a flush that never rejects.

import { describe, expect, it, vi } from "vitest";
import {
  classifyWriteFailure,
  createFlusher,
  drain,
  type OutboxStore,
  type QueuedEntry,
  type ReplayHandler,
} from "./outbox";

function makeStore(): OutboxStore & { all(): QueuedEntry[] } {
  let entries: QueuedEntry[] = [];
  let seq = 0;
  return {
    async enqueue(entry) {
      const id = `e${seq++}`;
      entries.push({ ...entry, id });
      return id;
    },
    async list() {
      return entries.map((e) => ({ ...e }));
    },
    async discard(id) {
      entries = entries.filter((e) => e.id !== id);
    },
    async put(entry) {
      entries = entries.map((e) => (e.id === entry.id ? { ...entry } : e));
    },
    all() {
      return entries;
    },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("classifyWriteFailure — validation is permanent", () => {
  it("treats a RangeError as a rejection, so the entry is never retried", () => {
    expect(classifyWriteFailure(new RangeError("annotation note must be 1–500 characters"))).toBe(
      "rejected",
    );
  });
});

describe("drain — entries are marked attempted before they are sent", () => {
  it("the handler sees attempted: true", async () => {
    const store = makeStore();
    await store.enqueue({ kind: "annotation-create", key: "k", payload: {}, ts: 1 });

    const seen: boolean[] = [];
    await drain(store, {
      "annotation-create": async (entry) => {
        seen.push(entry.attempted === true);
        return "applied";
      },
    });

    expect(seen).toEqual([true]);
    expect(store.all()).toHaveLength(0);
  });
});

describe("drain — revision check (B2)", () => {
  it("an entry edited while it applied is kept, and re-applied with the latest payload", async () => {
    const store = makeStore();
    await store.enqueue({ kind: "annotation-create", key: "a", payload: { note: null }, ts: 1 });
    await store.enqueue({ kind: "annotation-delete", key: "b", payload: {}, ts: 2 });

    const gate = deferred();
    const calls: string[] = [];
    const handlers: Partial<Record<string, ReplayHandler>> = {
      "annotation-create": async (entry) => {
        const note = (entry.payload as { note: string | null }).note;
        calls.push(`create:${note ?? "none"}`);
        if (calls.length === 1) await gate.promise;
        return "applied";
      },
      "annotation-delete": async () => {
        calls.push("delete");
        return "applied";
      },
    };

    const pass = drain(store, handlers);
    await vi.waitFor(() => expect(calls).toEqual(["create:none"]));

    // An edit bumps the revision while the first apply is still in flight.
    const [create] = store.all();
    await store.put!({ ...create, payload: { note: "late edit" }, rev: 1 });
    gate.resolve();
    await pass;

    // Only the first pass ran; the delete behind the changed create waited.
    expect(calls).toEqual(["create:none"]);
    expect(store.all().map((e) => e.kind)).toEqual(["annotation-create", "annotation-delete"]);

    await drain(store, handlers);
    expect(calls).toEqual(["create:none", "create:late edit", "delete"]);
    expect(store.all()).toHaveLength(0);
  });

  it("an entry cancelled while it applied is not resurrected", async () => {
    const store = makeStore();
    await store.enqueue({ kind: "annotation-note", key: "a", payload: {}, ts: 1 });

    const gate = deferred();
    const pass = drain(store, {
      "annotation-note": async () => {
        await gate.promise;
        return "applied";
      },
    });
    await vi.waitFor(() => expect(store.all()[0]?.attempted).toBe(true));

    const [note] = store.all();
    await store.discard(note.id);
    gate.resolve();
    await pass;

    expect(store.all()).toHaveLength(0);
  });
});

describe("drain — a transport failure blocks only its own item, in order", () => {
  // Replaces the earlier "entries behind a transport failure are not attempted"
  // case, which pinned the old stop-everything rule. The new rule: a transport
  // failure skips later entries of the SAME key (per-item FIFO), and other keys
  // carry on. Covered in depth by outbox-resilience.test.ts.
  it("entries of the same item behind a transport failure are not attempted; other items are", async () => {
    const store = makeStore();
    await store.enqueue({ kind: "reading-state", key: "a", payload: {}, ts: 1 });
    await store.enqueue({ kind: "reading-state", key: "a", payload: {}, ts: 2 });
    await store.enqueue({ kind: "reading-state", key: "b", payload: {}, ts: 3 });

    const seen: string[] = [];
    const result = await drain(store, {
      "reading-state": async (entry) => {
        seen.push(entry.key);
        return entry.key === "a" ? "transport" : "applied";
      },
    });

    expect(seen).toEqual(["a", "b"]);
    expect(result.requeued).toBe(1);
    expect(result.applied).toBe(1);
    expect(store.all().map((e) => e.key)).toEqual(["a", "a"]);
  });
});

describe("createFlusher — single-flight", () => {
  it("a request made while a pass runs gets exactly one more pass, and shares the promise", async () => {
    const store = makeStore();
    await store.enqueue({ kind: "annotation-note", key: "a", payload: { n: 1 }, ts: 1 });

    const gate = deferred();
    const calls: number[] = [];
    const flusher = createFlusher(store, () => ({
      "annotation-note": async (entry) => {
        const n = (entry.payload as { n: number }).n;
        calls.push(n);
        if (n === 1) await gate.promise;
        return "applied";
      },
    }));

    const first = flusher.flush();
    await vi.waitFor(() => expect(calls).toEqual([1]));

    await store.enqueue({ kind: "annotation-note", key: "b", payload: { n: 2 }, ts: 2 });
    const second = flusher.flush();
    const third = flusher.flush();
    expect(second).toBe(first);
    expect(third).toBe(first);

    gate.resolve();
    await first;

    expect(calls).toEqual([1, 2]);
    expect(store.all()).toHaveLength(0);
  });

  it("idle resolves once the running flush has finished", async () => {
    const store = makeStore();
    await store.enqueue({ kind: "annotation-note", key: "a", payload: {}, ts: 1 });
    const gate = deferred();
    const flusher = createFlusher(store, () => ({
      "annotation-note": async () => {
        await gate.promise;
        return "applied";
      },
    }));

    void flusher.flush();
    let idle = false;
    const waiting = flusher.idle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);

    gate.resolve();
    await waiting;
    expect(idle).toBe(true);
  });

  it("never rejects, even when the store itself throws", async () => {
    const broken: OutboxStore = {
      enqueue: async () => "x",
      list: async () => {
        throw new Error("storage gone");
      },
      discard: async () => {},
    };
    const flusher = createFlusher(broken, () => ({}));

    await expect(flusher.flush()).resolves.toBeUndefined();
  });
});
