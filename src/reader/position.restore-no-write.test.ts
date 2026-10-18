// Opening a book must not write a position until the reader navigates.
// `restore()` navigates the engine; the relocation that navigation causes is
// not a reader move, so it must not schedule a write, wherever it lands. The
// gate is decided by the relocation's `cause`, not its CFI: the first "next",
// "prev", or a "jump" that is not restore's own opens it. The db layer +
// Supabase client are mocked; the local cache is real jsdom localStorage.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/reading-state", () => ({
  getReadingState: vi.fn(),
  upsertReadingState: vi.fn(async () => {}),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
    },
  })),
}));

vi.mock("@/lib/offline/outbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/outbox")>();
  return {
    ...actual,
    classifyWriteFailure: vi.fn(() => "transport"),
    enqueueReadingState: vi.fn(async () => {}),
    getCachedUserId: vi.fn(async () => "u1"),
  };
});

import { getReadingState, upsertReadingState } from "@/lib/db/reading-state";
import type { ReaderController, ReaderLocationCause } from "./engine";
import { trackPosition } from "./position";
import { readCachedPosition, writeCachedPosition } from "./position-cache";

type Loc = { cfi: string; percent: number; cause?: ReaderLocationCause };
type RelocatedCb = (loc: Loc) => void;

const BOOK = "book1";
const SEEDED_AT = "2026-01-01T10:00:00.000Z";
const NEWER_AT = "2026-01-01T11:00:00.000Z";
const FAKE_NOW = new Date("2026-01-01T12:00:00.000Z");
const LOCAL_CFI = "epubcfi(/6/14!/4/2/1:0)";
const SERVER_CFI = "epubcfi(/6/30!/4/2/1:0)";
const SERVER_ROW_CFI = "epubcfi(/6/22!/4/2/1:0)";

function makeController(): ReaderController & { _emit: RelocatedCb } {
  const subs = new Set<RelocatedCb>();
  const c = {
    onRelocated: vi.fn((cb: RelocatedCb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    }),
    goTo: vi.fn(async () => {}),
    attach: vi.fn(async () => {}),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    relayout: vi.fn(),
    applySettings: vi.fn(),
    destroy: vi.fn(),
    sectionCount: 0,
    _emit: (loc: Loc) => subs.forEach((cb) => cb(loc)),
  };
  return c as unknown as ReaderController & { _emit: RelocatedCb };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(upsertReadingState).mockResolvedValue(undefined);
  vi.mocked(getReadingState).mockResolvedValue(undefined as never);
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(FAKE_NOW);
});

describe("restore does not write its own landing", () => {
  it("(a) restore from local cache: relocation on the restored CFI is not written or cached", async () => {
    writeCachedPosition(BOOK, {
      cfi: "epubcfi(/6/14!/4/2/1:0)",
      percent: 0.2,
      updatedAt: SEEDED_AT,
    });
    const c = makeController();
    const tracker = trackPosition(c, BOOK, { debounceMs: 1500 });

    await tracker.restore();
    expect(c.goTo).toHaveBeenCalledWith("epubcfi(/6/14!/4/2/1:0)");
    c._emit({ cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.2 });
    await vi.advanceTimersByTimeAsync(1500);

    expect(upsertReadingState).not.toHaveBeenCalled();
    // A cache rewrite would stamp `updatedAt` with the fake "now".
    expect(readCachedPosition(BOOK)?.updatedAt).toBe(SEEDED_AT);
    tracker.stop();
  });

  it("(a2) restore from local cache: landing at a different CFI with cause jump is not written", async () => {
    writeCachedPosition(BOOK, {
      cfi: LOCAL_CFI,
      percent: 0.2,
      updatedAt: SEEDED_AT,
    });
    const c = makeController();
    const tracker = trackPosition(c, BOOK, { debounceMs: 1500 });

    await tracker.restore();
    c._emit({ cfi: "epubcfi(/6/14!/4/4/1:0)", percent: 0.22, cause: "jump" });
    await vi.advanceTimersByTimeAsync(1500);

    expect(upsertReadingState).not.toHaveBeenCalled();
    expect(readCachedPosition(BOOK)?.updatedAt).toBe(SEEDED_AT);
    tracker.stop();
  });

  it("(a3) restore landing (different CFI) then an other relocation: neither is written", async () => {
    writeCachedPosition(BOOK, {
      cfi: LOCAL_CFI,
      percent: 0.2,
      updatedAt: SEEDED_AT,
    });
    const c = makeController();
    const tracker = trackPosition(c, BOOK, { debounceMs: 1500 });

    await tracker.restore();
    c._emit({ cfi: "epubcfi(/6/14!/4/4/1:0)", percent: 0.22, cause: "jump" });
    c._emit({ cfi: "epubcfi(/6/14!/4/6/1:0)", percent: 0.23, cause: "other" });
    await vi.advanceTimersByTimeAsync(1500);

    expect(upsertReadingState).not.toHaveBeenCalled();
    expect(readCachedPosition(BOOK)?.updatedAt).toBe(SEEDED_AT);
    tracker.stop();
  });

  it("(b) after restore, a next page turn to a different CFI is written once", async () => {
    writeCachedPosition(BOOK, {
      cfi: "epubcfi(/6/14!/4/2/1:0)",
      percent: 0.2,
      updatedAt: SEEDED_AT,
    });
    const c = makeController();
    const tracker = trackPosition(c, BOOK, { debounceMs: 1500 });

    await tracker.restore();
    c._emit({ cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.2 });
    c._emit({ cfi: "epubcfi(/6/14!/4/4/1:0)", percent: 0.25, cause: "next" });
    await vi.advanceTimersByTimeAsync(1500);

    expect(upsertReadingState).toHaveBeenCalledTimes(1);
    expect(upsertReadingState).toHaveBeenCalledWith(
      "u1",
      BOOK,
      { cfi: "epubcfi(/6/14!/4/4/1:0)", percent: 0.25 },
      expect.anything(),
    );
    tracker.stop();
  });

  it("(b2) restore landing then a next page turn: the turn is written", async () => {
    writeCachedPosition(BOOK, {
      cfi: LOCAL_CFI,
      percent: 0.2,
      updatedAt: SEEDED_AT,
    });
    const c = makeController();
    const tracker = trackPosition(c, BOOK, { debounceMs: 1500 });

    await tracker.restore();
    c._emit({ cfi: "epubcfi(/6/14!/4/4/1:0)", percent: 0.22, cause: "jump" });
    c._emit({ cfi: "epubcfi(/6/14!/4/6/1:0)", percent: 0.25, cause: "next" });
    await vi.advanceTimersByTimeAsync(1500);

    expect(upsertReadingState).toHaveBeenCalledTimes(1);
    expect(upsertReadingState).toHaveBeenCalledWith(
      "u1",
      BOOK,
      { cfi: "epubcfi(/6/14!/4/6/1:0)", percent: 0.25 },
      expect.anything(),
    );
    tracker.stop();
  });

  it("(c) no local cache: the server CFI landing is not written", async () => {
    vi.mocked(getReadingState).mockResolvedValue({
      book_id: BOOK,
      user_id: "u1",
      cfi: "epubcfi(/6/22!/4/2/1:0)",
      percent: 0.5,
      updated_at: SEEDED_AT,
    } as never);
    const c = makeController();
    const tracker = trackPosition(c, BOOK, { debounceMs: 1500 });

    await expect(tracker.restore()).resolves.toBe(true);
    expect(c.goTo).toHaveBeenCalledWith("epubcfi(/6/22!/4/2/1:0)");
    c._emit({ cfi: "epubcfi(/6/22!/4/2/1:0)", percent: 0.5 });
    await vi.advanceTimersByTimeAsync(1500);

    expect(upsertReadingState).not.toHaveBeenCalled();
    tracker.stop();
  });

  it("(c2) no local cache: landing at a different CFI than the server row with cause jump is not written", async () => {
    vi.mocked(getReadingState).mockResolvedValue({
      book_id: BOOK,
      user_id: "u1",
      cfi: SERVER_ROW_CFI,
      percent: 0.5,
      updated_at: SEEDED_AT,
    } as never);
    const c = makeController();
    const tracker = trackPosition(c, BOOK, { debounceMs: 1500 });

    await expect(tracker.restore()).resolves.toBe(true);
    c._emit({ cfi: "epubcfi(/6/22!/4/4/1:0)", percent: 0.51, cause: "jump" });
    await vi.advanceTimersByTimeAsync(1500);

    expect(upsertReadingState).not.toHaveBeenCalled();
    tracker.stop();
  });

  it("(d) accepting the sync offer (goTo the server CFI) is written", async () => {
    writeCachedPosition(BOOK, {
      cfi: "epubcfi(/6/14!/4/2/1:0)",
      percent: 0.2,
      updatedAt: SEEDED_AT,
    });
    const c = makeController();
    const tracker = trackPosition(c, BOOK, { debounceMs: 1500 });

    await tracker.restore();
    // Restore's own landing, on the restored CFI, arrives as a "jump".
    c._emit({ cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.2, cause: "jump" });
    // Accepting the offer navigates to the server CFI: a real reader move.
    await c.goTo("epubcfi(/6/30!/4/2/1:0)");
    c._emit({ cfi: "epubcfi(/6/30!/4/2/1:0)", percent: 0.6, cause: "jump" });
    await vi.advanceTimersByTimeAsync(1500);

    expect(upsertReadingState).toHaveBeenCalledTimes(1);
    expect(upsertReadingState).toHaveBeenCalledWith(
      "u1",
      BOOK,
      { cfi: "epubcfi(/6/30!/4/2/1:0)", percent: 0.6 },
      expect.anything(),
    );
    tracker.stop();
  });

  it("(d2) sync offer from the background reconcile, accepted: the jump is written", async () => {
    writeCachedPosition(BOOK, {
      cfi: LOCAL_CFI,
      percent: 0.2,
      updatedAt: SEEDED_AT,
    });
    vi.mocked(getReadingState).mockResolvedValue({
      book_id: BOOK,
      user_id: "u1",
      cfi: SERVER_CFI,
      percent: 0.6,
      updated_at: NEWER_AT,
    } as never);
    const c = makeController();
    const tracker = trackPosition(c, BOOK, { debounceMs: 1500 });
    const offers: string[] = [];
    tracker.onSyncOffer((offer) => offers.push(offer.cfi));

    await tracker.restore();
    c._emit({ cfi: LOCAL_CFI, percent: 0.2, cause: "jump" });
    await vi.advanceTimersByTimeAsync(10);
    expect(offers).toEqual([SERVER_CFI]);

    await c.goTo(offers[0]);
    c._emit({ cfi: SERVER_CFI, percent: 0.6, cause: "jump" });
    await vi.advanceTimersByTimeAsync(1500);

    expect(upsertReadingState).toHaveBeenCalledTimes(1);
    expect(upsertReadingState).toHaveBeenCalledWith(
      "u1",
      BOOK,
      { cfi: SERVER_CFI, percent: 0.6 },
      expect.anything(),
    );
    tracker.stop();
  });

  it("(f) landing arrives before settle as other; the accept jump is swallowed (documented cost); next writes", async () => {
    writeCachedPosition(BOOK, {
      cfi: LOCAL_CFI,
      percent: 0.2,
      updatedAt: SEEDED_AT,
    });
    const c = makeController();
    const tracker = trackPosition(c, BOOK, { debounceMs: 1500 });

    await tracker.restore();
    // Landing before display() settles is tagged "other": not written, and
    // the restore landing is still owed.
    c._emit({ cfi: "epubcfi(/6/14!/4/4/1:0)", percent: 0.22, cause: "other" });
    // The accept goTo's "jump" is taken as restore's owed landing, so this
    // one relocation is not written (accepted cost; see position.ts).
    c._emit({ cfi: SERVER_CFI, percent: 0.6, cause: "jump" });
    c._emit({ cfi: "epubcfi(/6/30!/4/4/1:0)", percent: 0.61, cause: "next" });
    await vi.advanceTimersByTimeAsync(1500);

    expect(upsertReadingState).toHaveBeenCalledTimes(1);
    expect(upsertReadingState).toHaveBeenCalledWith(
      "u1",
      BOOK,
      { cfi: "epubcfi(/6/30!/4/4/1:0)", percent: 0.61 },
      expect.anything(),
    );
    tracker.stop();
  });
});
