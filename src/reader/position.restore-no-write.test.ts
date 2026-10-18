// Opening a book must not write the restored position back to the server.
// `restore()` navigates the engine; the relocation that navigation causes lands
// on the restored CFI and is not a reader move, so it must not schedule a
// write. The first relocation to a DIFFERENT CFI (page turn, jump, accepting a
// sync offer) writes as normal. The db layer + Supabase client are mocked; the
// local cache is real jsdom localStorage.

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
import type { ReaderController } from "./engine";
import { trackPosition } from "./position";
import { readCachedPosition, writeCachedPosition } from "./position-cache";

type RelocatedCb = (loc: { cfi: string; percent: number }) => void;

const BOOK = "book1";
const SEEDED_AT = "2026-01-01T10:00:00.000Z";
const FAKE_NOW = new Date("2026-01-01T12:00:00.000Z");

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
    _emit: (loc: { cfi: string; percent: number }) =>
      subs.forEach((cb) => cb(loc)),
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

  it("(b) after restore, a relocation to a different CFI is written once", async () => {
    writeCachedPosition(BOOK, {
      cfi: "epubcfi(/6/14!/4/2/1:0)",
      percent: 0.2,
      updatedAt: SEEDED_AT,
    });
    const c = makeController();
    const tracker = trackPosition(c, BOOK, { debounceMs: 1500 });

    await tracker.restore();
    c._emit({ cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.2 });
    c._emit({ cfi: "epubcfi(/6/14!/4/4/1:0)", percent: 0.25 });
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

  it("(d) accepting the sync offer (goTo the server CFI) is written", async () => {
    writeCachedPosition(BOOK, {
      cfi: "epubcfi(/6/14!/4/2/1:0)",
      percent: 0.2,
      updatedAt: SEEDED_AT,
    });
    const c = makeController();
    const tracker = trackPosition(c, BOOK, { debounceMs: 1500 });

    await tracker.restore();
    // Accepting the offer navigates to the server CFI, which differs from the
    // restored one, so its relocation is a real reader move and writes.
    await c.goTo("epubcfi(/6/30!/4/2/1:0)");
    c._emit({ cfi: "epubcfi(/6/30!/4/2/1:0)", percent: 0.6 });
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
});
