// The "reading-state" outbox kind end to end against fake-indexeddb: the real
// replay handler, driven the way production drives it (the `online` event),
// with the reading_state DB helpers mocked at the boundary. The generic drain
// rules are in outbox.test.ts; this file covers the newest-write-wins replay
// rule for reading state.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getReadingState: vi.fn(
    async (..._a: unknown[]): Promise<{ cfi: string | null; percent: number; updated_at: string } | null> =>
      null,
  ),
  upsertReadingState: vi.fn(async (..._a: unknown[]) => {}),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({ marker: "browser-client" })),
}));
vi.mock("@/lib/db/reading-state", () => ({
  getReadingState: h.getReadingState,
  upsertReadingState: h.upsertReadingState,
}));

import { createIndexedDbStore, enqueueReadingState, purgeOutbox } from "./outbox";

const store = createIndexedDbStore();

const USER = "u1";
const BOOK = "b1";
// The queued entry is stamped with this wall-clock time via Date.now().
const ENTRY_TS = Date.parse("2026-10-18T10:00:00.000Z");

async function queued() {
  return (await store.list()).filter((e) => e.kind === "reading-state");
}

/** Queue one reading-state write, stamped at ENTRY_TS. */
async function enqueueAt(percent: number, cfi: string) {
  const spy = vi.spyOn(Date, "now").mockReturnValue(ENTRY_TS);
  try {
    await enqueueReadingState(USER, BOOK, { cfi, percent });
  } finally {
    spy.mockRestore();
  }
}

/** Fire the `online` event and wait until the queued entry is settled. */
async function replay() {
  window.dispatchEvent(new Event("online"));
  await vi.waitFor(async () => expect(await queued()).toHaveLength(0));
  // Let the handler's post-write bookkeeping finish before asserting.
  await new Promise((r) => setTimeout(r, 20));
}

beforeEach(async () => {
  vi.clearAllMocks();
  h.getReadingState.mockResolvedValue(null);
  h.upsertReadingState.mockResolvedValue(undefined);
  globalThis.indexedDB = new IDBFactory();
  await purgeOutbox();
  globalThis.indexedDB = new IDBFactory();
});

describe("reading-state replay — newest write wins", () => {
  it("applies a queued backwards move when the server row is older than the entry", async () => {
    // The founder's repro: the server holds page 3 (written 09:00); the reader
    // paged back to page 1 at 10:00, and that write only reached the outbox.
    h.getReadingState.mockResolvedValue({
      cfi: "cfi-page-3",
      percent: 0.5,
      updated_at: "2026-10-18T09:00:00.000Z",
    });
    await enqueueAt(0.1, "cfi-page-1");

    await replay();

    expect(h.upsertReadingState).toHaveBeenCalledTimes(1);
    expect(h.upsertReadingState).toHaveBeenCalledWith(
      USER,
      BOOK,
      { cfi: "cfi-page-1", percent: 0.1 },
      { marker: "browser-client" },
    );
  });

  it("skips a queued write when the server row was written after the entry, even if the queued position is further", async () => {
    // Another device wrote at 11:00, after this entry was queued at 10:00.
    h.getReadingState.mockResolvedValue({
      cfi: "cfi-other-device",
      percent: 0.2,
      updated_at: "2026-10-18T11:00:00.000Z",
    });
    await enqueueAt(0.6, "cfi-stale-far");

    await replay();

    expect(h.upsertReadingState).not.toHaveBeenCalled();
  });

  it("applies a queued write when there is no server row yet", async () => {
    h.getReadingState.mockResolvedValue(null);
    await enqueueAt(0.4, "cfi-first");

    await replay();

    expect(h.upsertReadingState).toHaveBeenCalledTimes(1);
    expect(h.upsertReadingState.mock.calls[0][2]).toEqual({ cfi: "cfi-first", percent: 0.4 });
  });

  it("applies a queued write when the server row has the same timestamp as the entry", async () => {
    h.getReadingState.mockResolvedValue({
      cfi: "cfi-page-3",
      percent: 0.5,
      updated_at: "2026-10-18T10:00:00.000Z",
    });
    await enqueueAt(0.1, "cfi-page-1");

    await replay();

    expect(h.upsertReadingState).toHaveBeenCalledTimes(1);
    expect(h.upsertReadingState.mock.calls[0][2]).toEqual({ cfi: "cfi-page-1", percent: 0.1 });
  });
});
