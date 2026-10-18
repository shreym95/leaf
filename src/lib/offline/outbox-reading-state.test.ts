// The "reading-state" outbox kind end to end against fake-indexeddb: the real
// replay handler, driven the way production drives it (the `online` event),
// with the reading_state DB helpers mocked at the boundary by a stateful fake
// server row (upsert writes it, get reads it back). The generic drain rules are
// in outbox.test.ts; this file covers the newest-write-wins replay rule for
// reading state. The wall clock is faked (Date only) so the replay time and the
// queued entry times are controlled.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ServerRow = { cfi: string | null; percent: number; updated_at: string };

const h = vi.hoisted(() => ({
  // The one server row for (user, book). Null until something is written.
  row: null as ServerRow | null,
  getReadingState: vi.fn(async (..._a: unknown[]): Promise<ServerRow | null> => null),
  upsertReadingState: vi.fn(async (..._a: unknown[]): Promise<void> => {}),
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
const REPLAY_TS = Date.parse("2026-10-18T12:00:00.000Z");
const ENTRY_TS = Date.parse("2026-10-18T10:00:00.000Z");

async function queued() {
  return (await store.list()).filter((e) => e.kind === "reading-state");
}

/** Queue one reading-state write, stamped at `at` (defaults to ENTRY_TS). */
async function enqueueAt(percent: number, cfi: string, at: number = ENTRY_TS) {
  vi.setSystemTime(at);
  await enqueueReadingState(USER, BOOK, { cfi, percent });
}

/** Fire the `online` event at REPLAY_TS and wait until the queued entries are settled. */
async function replay() {
  vi.setSystemTime(REPLAY_TS);
  window.dispatchEvent(new Event("online"));
  await vi.waitFor(async () => expect(await queued()).toHaveLength(0));
  // Let the handler's post-write bookkeeping finish before asserting.
  await new Promise((r) => setTimeout(r, 20));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.clearAllMocks();
  h.row = null;
  h.getReadingState.mockImplementation(async () => h.row);
  h.upsertReadingState.mockImplementation(async (...args: unknown[]) => {
    const patch = args[2] as { cfi: string; percent: number; updatedAt?: string };
    h.row = {
      cfi: patch.cfi,
      percent: patch.percent,
      updated_at: patch.updatedAt ?? new Date().toISOString(),
    };
  });
  globalThis.indexedDB = new IDBFactory();
  await purgeOutbox();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.useRealTimers();
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
      { cfi: "cfi-page-1", percent: 0.1, updatedAt: "2026-10-18T10:00:00.000Z" },
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
    expect(h.upsertReadingState.mock.calls[0][2]).toEqual({
      cfi: "cfi-first",
      percent: 0.4,
      updatedAt: "2026-10-18T10:00:00.000Z",
    });
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
    expect(h.upsertReadingState.mock.calls[0][2]).toEqual({
      cfi: "cfi-page-1",
      percent: 0.1,
      updatedAt: "2026-10-18T10:00:00.000Z",
    });
  });

  it("two queued entries replayed after a 09:00 server row: the newest entry (10:01) ends the server row", async () => {
    // Offline: p2 queued at 10:00, then p3 at 10:01. Replay runs at 12:00. The
    // oldest entry must not win, so each write is stamped with its entry time.
    h.row = { cfi: "cfi-page-0", percent: 0.1, updated_at: "2026-10-18T09:00:00.000Z" };
    await enqueueAt(0.2, "cfi-page-2", ENTRY_TS);
    await enqueueAt(0.3, "cfi-page-3", Date.parse("2026-10-18T10:01:00.000Z"));

    await replay();

    expect(h.upsertReadingState).toHaveBeenCalledTimes(2);
    expect(h.row).toEqual({
      cfi: "cfi-page-3",
      percent: 0.3,
      updated_at: "2026-10-18T10:01:00.000Z",
    });
  });

  it("applies a queued backwards move when the server row is older than the entry (p3@10:00, p1@10:05)", async () => {
    // The server holds p3 written at 10:00; the queued p1 was read at 10:05, so it applies.
    h.row = { cfi: "cfi-page-3", percent: 0.3, updated_at: "2026-10-18T10:00:00.000Z" };
    await enqueueAt(0.1, "cfi-page-1", Date.parse("2026-10-18T10:05:00.000Z"));

    await replay();

    expect(h.upsertReadingState).toHaveBeenCalledTimes(1);
    expect(h.row).toEqual({
      cfi: "cfi-page-1",
      percent: 0.1,
      updated_at: "2026-10-18T10:05:00.000Z",
    });
  });

  it("stamps a direct write with the current time when no updatedAt is given", async () => {
    // The reader's direct write (src/reader/position.ts) passes no updatedAt.
    // Exercise the real helper against a recording client, with the clock at REPLAY_TS.
    // vi.importActual bypasses the module mock above.
    const actual = await vi.importActual<typeof import("@/lib/db/reading-state")>("@/lib/db/reading-state");
    const upsert = vi.fn(async (..._a: unknown[]) => ({ error: null }));
    const client = { from: vi.fn(() => ({ upsert })) };
    vi.setSystemTime(REPLAY_TS);

    await actual.upsertReadingState(USER, BOOK, { cfi: "cfi-now", percent: 0.7 }, client as never);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({ updated_at: "2026-10-18T12:00:00.000Z" });
  });
});
