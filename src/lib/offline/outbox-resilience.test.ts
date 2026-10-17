// Replay resilience: a hung handler is timed out, a failing item does not block
// other items, per-item order survives a skip, a streak of transport failures
// stops the pass, and each pass runs under the cross-tab Web Lock when present.
// In-memory store only: no IndexedDB, no network, no real Web Locks.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFlusher,
  drain,
  HANDLER_TIMEOUT_MS,
  type OutboxKind,
  type OutboxStore,
  type QueuedEntry,
  type ReplayHandler,
  type ReplayOutcome,
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

/** A queued reading-state entry for `key`, labelled so tests can read the apply order. */
function item(store: OutboxStore, key: string, label: string): Promise<string> {
  return store.enqueue({ kind: "reading-state", key, payload: { label }, ts: 1 });
}

function labelOf(entry: QueuedEntry): string {
  return (entry.payload as { label: string }).label;
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "locks");
});

describe("handler timeout — a hung write cannot hold the flush forever", () => {
  it("a handler that never resolves times out after 20 s, keeps its entry, and a later flush runs", async () => {
    vi.useFakeTimers();
    const store = makeStore();
    await item(store, "a", "a1");

    let calls = 0;
    let releaseHung: (outcome: ReplayOutcome) => void = () => {};
    const flusher = createFlusher(store, () => ({
      "reading-state": () => {
        calls += 1;
        if (calls === 1) {
          // Hangs past the timeout; settled by hand below.
          return new Promise<ReplayOutcome>((resolve) => {
            releaseHung = resolve;
          });
        }
        return Promise.resolve("applied");
      },
    }));

    let firstSettled = false;
    const first = flusher.flush().then(() => {
      firstSettled = true;
    });

    await vi.advanceTimersByTimeAsync(HANDLER_TIMEOUT_MS - 1);
    expect(firstSettled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(firstSettled).toBe(true);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0].attempted).toBe(true);

    // While the timed-out request is still unsettled, no second request for the
    // same item may start (it could be overtaken by the late one).
    await flusher.flush();
    expect(calls).toBe(1);

    // Once it settles, a later flush runs and applies the entry.
    releaseHung("applied");
    await vi.advanceTimersByTimeAsync(0);
    await flusher.flush();
    expect(calls).toBe(2);
    expect(store.all()).toHaveLength(0);
  });
});

describe("per-item isolation — a failing item does not block other items", () => {
  it("a codeless failure on key A does not block key B", async () => {
    const store = makeStore();
    await item(store, "A", "a1");
    await item(store, "B", "b1");

    const result = await drain(store, {
      "reading-state": async (entry) => {
        if (entry.key === "A") throw new Error("socket reset"); // no `code`: transport
        return "applied";
      },
    });

    expect(result.applied).toBe(1);
    expect(result.requeued).toBe(1);
    expect(store.all().map((e) => e.key)).toEqual(["A"]);
  });

  it("per-item order holds after a skip: A2 waits for A1, and never overtakes it", async () => {
    const store = makeStore();
    await item(store, "A", "a1");
    await item(store, "A", "a2");
    await item(store, "B", "b1");

    const seen: string[] = [];
    let failA = true;
    const handlers: Partial<Record<OutboxKind, ReplayHandler>> = {
      "reading-state": async (entry) => {
        seen.push(labelOf(entry));
        if (entry.key === "A" && failA) return "transport";
        return "applied";
      },
    };

    await drain(store, handlers);
    expect(seen).toEqual(["a1", "b1"]); // a2 skipped behind its failed item
    expect(store.all().map((e) => labelOf(e))).toEqual(["a1", "a2"]);

    failA = false;
    await drain(store, handlers);
    expect(seen).toEqual(["a1", "b1", "a1", "a2"]); // A in order once it recovers
    expect(store.all()).toHaveLength(0);
  });

  it("three consecutive transport failures on different keys stop the pass", async () => {
    const store = makeStore();
    for (const key of ["A", "B", "C", "D"]) await item(store, key, key);

    const seen: string[] = [];
    const result = await drain(store, {
      "reading-state": async (entry) => {
        seen.push(entry.key);
        return "transport";
      },
    });

    expect(seen).toEqual(["A", "B", "C"]); // D never attempted
    expect(result.requeued).toBe(3);
    expect(store.all()).toHaveLength(4);
  });

  it("a success resets the transport streak, so two failures in a row never stop the pass", async () => {
    const store = makeStore();
    for (const key of ["A", "B", "C", "D", "E"]) await item(store, key, key);

    const seen: string[] = [];
    const result = await drain(store, {
      "reading-state": async (entry) => {
        seen.push(entry.key);
        return entry.key === "C" ? "applied" : "transport";
      },
    });

    expect(seen).toEqual(["A", "B", "C", "D", "E"]);
    expect(result.requeued).toBe(4);
    expect(result.applied).toBe(1);
  });
});

/** A minimal `navigator.locks`: requests on one name run one at a time, in order. */
function installLocks(): { requested: string[]; held: Set<string> } {
  const tails = new Map<string, Promise<unknown>>();
  const requested: string[] = [];
  const held = new Set<string>();
  const locks = {
    request(name: string, callback: () => unknown): Promise<unknown> {
      requested.push(name);
      const previous = tails.get(name) ?? Promise.resolve();
      const run = previous.then(async () => {
        held.add(name);
        try {
          return await callback();
        } finally {
          held.delete(name);
        }
      });
      tails.set(name, run.catch(() => undefined));
      return run;
    },
  };
  Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
  return { requested, held };
}

describe("cross-tab flush lock — Web Locks when present, per-tab otherwise", () => {
  it("runs each pass under the 'leaf-outbox-flush' lock", async () => {
    const { requested, held } = installLocks();
    const store = makeStore();
    await item(store, "a", "a1");

    const heldAtApply: boolean[] = [];
    const flusher = createFlusher(store, () => ({
      "reading-state": async () => {
        heldAtApply.push(held.has("leaf-outbox-flush"));
        return "applied";
      },
    }));

    await flusher.flush();

    expect(requested).toContain("leaf-outbox-flush");
    expect(heldAtApply).toEqual([true]);
    expect(store.all()).toHaveLength(0);
  });

  it("two tabs' passes never apply entries at the same time", async () => {
    installLocks();
    const store = makeStore();
    await item(store, "a", "a1");
    await item(store, "b", "b1");

    let active = 0;
    let maxActive = 0;
    const handlers = () => ({
      "reading-state": async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 0));
        active -= 1;
        return "applied" as const;
      },
    });

    // Two flushers over one store: two tabs sharing the same IndexedDB.
    const tabA = createFlusher(store, handlers);
    const tabB = createFlusher(store, handlers);
    await Promise.all([tabA.flush(), tabB.flush()]);

    expect(maxActive).toBe(1);
    expect(store.all()).toHaveLength(0);
  });

  it("falls back to the per-tab single-flight when Web Locks is absent", async () => {
    Reflect.deleteProperty(navigator, "locks");
    const store = makeStore();
    await item(store, "a", "a1");

    const flusher = createFlusher(store, () => ({
      "reading-state": async () => "applied",
    }));
    await expect(flusher.flush()).resolves.toBeUndefined();

    expect(store.all()).toHaveLength(0);
  });
});

/** Edit the queued entry for `key` in place, as the writer does: same id, `rev` + 1. */
async function editEntry(store: OutboxStore, key: string, label: string): Promise<void> {
  const current = (await store.list()).find((e) => e.key === key);
  if (!current) throw new Error(`no queued entry for ${key}`);
  await store.put?.({ ...current, payload: { label }, rev: (current.rev ?? 0) + 1 });
}

describe("in-flight attempts — a timed-out request is never overtaken", () => {
  it("an edited entry is not re-sent while its timed-out request is unsettled; the newest payload lands last", async () => {
    vi.useFakeTimers();
    const store = makeStore();
    await item(store, "a", "a1");

    const payloads: string[] = [];
    let server = "";
    let settleOld: (outcome: ReplayOutcome) => void = () => {};
    const flusher = createFlusher(store, () => ({
      "reading-state": (entry) => {
        const label = labelOf(entry);
        payloads.push(label);
        if (payloads.length === 1) {
          // The first request hangs. When it finally lands, it writes its own value.
          return new Promise<ReplayOutcome>((resolve) => {
            settleOld = (outcome) => {
              server = label;
              resolve(outcome);
            };
          });
        }
        server = label;
        return Promise.resolve("applied");
      },
    }));

    void flusher.flush();
    await vi.advanceTimersByTimeAsync(1); // the first request is now in flight
    await editEntry(store, "a", "a2"); // the user edits it meanwhile
    await vi.advanceTimersByTimeAsync(HANDLER_TIMEOUT_MS); // the first attempt times out

    expect(payloads).toEqual(["a1"]); // a2 is NOT sent while a1 is unsettled
    expect(store.all()).toHaveLength(1);

    settleOld("applied"); // the late response lands
    await vi.advanceTimersByTimeAsync(1); // the settle reaches the flusher, which runs again
    await flusher.flush();
    expect(payloads).toEqual(["a1", "a2"]);
    expect(server).toBe("a2"); // the newest write is the last one the server saw
    expect(store.all()).toHaveLength(0);
  });

  it("while the old request is unsettled, other keys keep flowing", async () => {
    vi.useFakeTimers();
    const store = makeStore();
    await item(store, "A", "a1");
    await item(store, "B", "b1");

    const calls: string[] = [];
    let settleOld: (outcome: ReplayOutcome) => void = () => {};
    const flusher = createFlusher(store, () => ({
      "reading-state": (entry) => {
        calls.push(labelOf(entry));
        if (calls.length === 1) {
          return new Promise<ReplayOutcome>((resolve) => {
            settleOld = resolve;
          });
        }
        return Promise.resolve("applied");
      },
    }));

    void flusher.flush();
    await vi.advanceTimersByTimeAsync(1);
    await editEntry(store, "A", "a2");
    await vi.advanceTimersByTimeAsync(HANDLER_TIMEOUT_MS);

    expect(calls).toEqual(["a1", "b1"]); // A waits; B is written meanwhile
    expect(store.all().map((e) => labelOf(e))).toEqual(["a2"]);

    settleOld("applied");
    await vi.advanceTimersByTimeAsync(1); // the settle reaches the flusher, which runs again
    await flusher.flush();
    expect(calls).toEqual(["a1", "b1", "a2"]);
    expect(store.all()).toHaveLength(0);
  });
});
