// The CFI round-trip (SPEC §3.7) — the HARD requirement: a position saved on
// relocation is the exact CFI restored on reopen. The db layer + Supabase
// client are mocked; we drive the engine's `relocated` stream through a fake
// controller.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/reading-state", () => ({
  getReadingState: vi.fn(),
  upsertReadingState: vi.fn(async () => {}),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
    },
  })),
}));

import { getReadingState, upsertReadingState } from "@/lib/db/reading-state";
import type { ReaderController } from "./engine";
import { trackPosition } from "./position";

type RelocatedCb = (loc: { cfi: string; percent: number }) => void;

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
});

describe("save path", () => {
  it("writes the relocated CFI once the debounce window elapses", async () => {
    vi.useFakeTimers();
    const c = makeController();
    trackPosition(c, "book1", { debounceMs: 1500 });

    c._emit({ cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.42 });
    expect(upsertReadingState).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);

    expect(upsertReadingState).toHaveBeenCalledTimes(1);
    expect(upsertReadingState).toHaveBeenCalledWith(
      "u1",
      "book1",
      { cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.42 },
      expect.anything(),
    );
    vi.useRealTimers();
  });

  it("collapses rapid relocations into a single write (last value wins)", async () => {
    vi.useFakeTimers();
    const c = makeController();
    trackPosition(c, "book1", { debounceMs: 1000 });

    c._emit({ cfi: "A", percent: 0.1 });
    await vi.advanceTimersByTimeAsync(300);
    c._emit({ cfi: "B", percent: 0.2 });
    await vi.advanceTimersByTimeAsync(300);
    c._emit({ cfi: "C", percent: 0.3 });
    await vi.advanceTimersByTimeAsync(1000);

    expect(upsertReadingState).toHaveBeenCalledTimes(1);
    expect(upsertReadingState).toHaveBeenCalledWith(
      "u1",
      "book1",
      { cfi: "C", percent: 0.3 },
      expect.anything(),
    );
    vi.useRealTimers();
  });
});

describe("restore path", () => {
  it("navigates to the stored CFI and returns true", async () => {
    vi.mocked(getReadingState).mockResolvedValue({
      book_id: "book1",
      user_id: "u1",
      cfi: "epubcfi(/6/14!/4/2/1:0)",
      percent: 0.42,
      updated_at: "2026-08-30T00:00:00Z",
    });

    const c = makeController();
    const tracker = trackPosition(c, "book1");
    const ok = await tracker.restore();

    expect(ok).toBe(true);
    expect(c.goTo).toHaveBeenCalledWith("epubcfi(/6/14!/4/2/1:0)");
  });

  it("returns false and does not navigate when no row is stored", async () => {
    vi.mocked(getReadingState).mockResolvedValue(null);

    const c = makeController();
    const ok = await trackPosition(c, "book1").restore();

    expect(ok).toBe(false);
    expect(c.goTo).not.toHaveBeenCalled();
  });
});

describe("full round-trip", () => {
  it("the CFI saved on relocation is the exact CFI restored by a fresh tracker", async () => {
    vi.useFakeTimers();

    // A tiny in-memory stand-in for the reading_state row.
    const store: { cfi: string | null; percent: number } = {
      cfi: null,
      percent: 0,
    };
    vi.mocked(upsertReadingState).mockImplementation(
      async (_userId, _bookId, patch) => {
        store.cfi = patch.cfi;
        store.percent = patch.percent;
      },
    );
    vi.mocked(getReadingState).mockImplementation(async () =>
      store.cfi
        ? {
            book_id: "book1",
            user_id: "u1",
            cfi: store.cfi,
            percent: store.percent,
            updated_at: "2026-08-30T00:00:00Z",
          }
        : null,
    );

    const CFI = "epubcfi(/6/22!/4/2/8/1:137)";

    // Device A: read, relocate, tracker persists.
    const deviceA = makeController();
    const trackerA = trackPosition(deviceA, "book1", { debounceMs: 1500 });
    deviceA._emit({ cfi: CFI, percent: 0.63 });
    await vi.advanceTimersByTimeAsync(1500);
    trackerA.stop();

    expect(store.cfi).toBe(CFI);

    // Device B: fresh tracker, restore lands on device A's CFI.
    const deviceB = makeController();
    const trackerB = trackPosition(deviceB, "book1");
    const ok = await trackerB.restore();

    vi.useRealTimers();

    expect(ok).toBe(true);
    expect(deviceB.goTo).toHaveBeenCalledWith(CFI);
    expect(deviceB.goTo).toHaveBeenCalledTimes(1);
  });
});
