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
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
    },
  })),
}));

vi.mock("@/lib/offline/outbox", () => ({
  classifyWriteFailure: vi.fn(() => "transport"),
  enqueueReadingState: vi.fn(async () => {}),
  getCachedUserId: vi.fn(async () => "u1"),
}));

import { getReadingState, upsertReadingState } from "@/lib/db/reading-state";
import {
  classifyWriteFailure,
  enqueueReadingState,
  getCachedUserId,
} from "@/lib/offline/outbox";
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
  // `clearAllMocks` resets call history but not implementations set with
  // `mockResolvedValue` / `mockReturnValue` — reset the outbox mocks to sane
  // defaults so one test's failure-path setup can't leak into the next.
  vi.mocked(upsertReadingState).mockResolvedValue(undefined);
  vi.mocked(classifyWriteFailure).mockReturnValue("transport");
  vi.mocked(getCachedUserId).mockResolvedValue("u1");
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

describe("offline queuing (§8a / D8 item 4)", () => {
  it("queues the write when it fails with a transport error", async () => {
    vi.useFakeTimers();
    vi.mocked(classifyWriteFailure).mockReturnValue("transport");
    vi.mocked(upsertReadingState).mockRejectedValue(new TypeError("Failed to fetch"));

    const c = makeController();
    trackPosition(c, "book1", { debounceMs: 1500 });
    c._emit({ cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.42 });
    await vi.advanceTimersByTimeAsync(1500);

    expect(enqueueReadingState).toHaveBeenCalledWith(
      "u1",
      "book1",
      { cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.42 },
    );
    vi.useRealTimers();
  });

  it("does NOT queue when the failure is a rejection (RLS / bad data)", async () => {
    vi.useFakeTimers();
    vi.mocked(classifyWriteFailure).mockReturnValue("rejected");
    vi.mocked(upsertReadingState).mockRejectedValue({ code: "42501" });

    const c = makeController();
    trackPosition(c, "book1", { debounceMs: 1500 });
    c._emit({ cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.42 });
    await vi.advanceTimersByTimeAsync(1500);

    expect(enqueueReadingState).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not queue when there is no cached identity to queue against", async () => {
    vi.useFakeTimers();
    vi.mocked(classifyWriteFailure).mockReturnValue("transport");
    vi.mocked(upsertReadingState).mockRejectedValue(new TypeError("Failed to fetch"));
    vi.mocked(getCachedUserId).mockResolvedValue(null);

    const c = makeController();
    trackPosition(c, "book1", { debounceMs: 1500 });
    c._emit({ cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.42 });
    await vi.advanceTimersByTimeAsync(1500);

    expect(enqueueReadingState).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("page-hide flush (D8)", () => {
  it("enqueues a pending write on visibilitychange -> hidden, without touching the network", async () => {
    vi.useFakeTimers();
    const c = makeController();
    const tracker = trackPosition(c, "book1", { debounceMs: 1500 });

    c._emit({ cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.42 });
    // Debounce window has NOT elapsed — the write is still only pending.
    expect(upsertReadingState).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();

    expect(upsertReadingState).not.toHaveBeenCalled();
    expect(enqueueReadingState).toHaveBeenCalledWith(
      "u1",
      "book1",
      { cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.42 },
    );

    // The debounce timer fires later: nothing left to flush.
    await vi.advanceTimersByTimeAsync(1500);
    expect(upsertReadingState).not.toHaveBeenCalled();

    tracker.stop();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    vi.useRealTimers();
  });

  it("enqueues a pending write on pagehide", async () => {
    vi.useFakeTimers();
    const c = makeController();
    const tracker = trackPosition(c, "book1", { debounceMs: 1500 });

    c._emit({ cfi: "epubcfi(/6/20!/4/2/1:0)", percent: 0.77 });
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    await Promise.resolve();

    expect(enqueueReadingState).toHaveBeenCalledWith(
      "u1",
      "book1",
      { cfi: "epubcfi(/6/20!/4/2/1:0)", percent: 0.77 },
    );

    tracker.stop();
    vi.useRealTimers();
  });

  it("does nothing on hide when there is no pending write", async () => {
    const c = makeController();
    const tracker = trackPosition(c, "book1");

    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();

    expect(enqueueReadingState).not.toHaveBeenCalled();
    tracker.stop();
  });

  it("stop() removes the visibilitychange/pagehide listeners", async () => {
    const c = makeController();
    const tracker = trackPosition(c, "book1", { debounceMs: 1500 });
    c._emit({ cfi: "epubcfi(/6/1!/4/2/1:0)", percent: 0.1 });
    tracker.stop(); // flushes the pending write itself, and clears `pending`
    // Let that fire-and-forget flush's promise chain settle before clearing
    // mocks, so it isn't mistaken for a call caused by the events below.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    vi.clearAllMocks();

    // A hide event after stop() must not do anything more — no listener left.
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();

    expect(enqueueReadingState).not.toHaveBeenCalled();
    expect(upsertReadingState).not.toHaveBeenCalled();
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
