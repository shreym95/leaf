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

vi.mock("@/lib/offline/outbox", async (importOriginal) => {
  // `isFurtherAlong` is kept real (pure, no I/O) rather than mocked: the
  // "restore merges local + server" tests below exercise the actual §8(b)
  // rule through `pickFurthestPosition`, not a stand-in for it.
  const actual = await importOriginal<typeof import("@/lib/offline/outbox")>();
  return {
    ...actual,
    classifyWriteFailure: vi.fn(() => "transport"),
    enqueueReadingState: vi.fn(async () => {}),
    getCachedUserId: vi.fn(async () => "u1"),
  };
});

import { getReadingState, upsertReadingState } from "@/lib/db/reading-state";
import {
  classifyWriteFailure,
  enqueueReadingState,
  getCachedUserId,
} from "@/lib/offline/outbox";
import type { ReaderController } from "./engine";
import {
  isMeaningfullyAhead,
  pickFurthestPosition,
  SERVER_LEG_TIMEOUT_MS,
  SYNC_OFFER_MIN_PERCENT_AHEAD,
  trackPosition,
} from "./position";
import { writeCachedPosition } from "./position-cache";

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
  // Every test in this file uses bookId "book1"; the local position cache is
  // real jsdom localStorage (not mocked, same convention as
  // locations-cache.test.ts), so it must be cleared between tests or one
  // test's write leaks into the next as a spurious local position.
  window.localStorage.clear();
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

describe("furthest-position merge (offline restore fix)", () => {
  const local = (percent: number, updatedAt = "2026-01-01T00:00:00Z") => ({
    cfi: "local-cfi",
    percent,
    updatedAt,
  });
  const server = (percent: number, updatedAt = "2026-01-01T00:00:00Z") => ({
    cfi: "server-cfi",
    percent,
    updatedAt,
  });

  it("picks local when local is further along", () => {
    expect(pickFurthestPosition(local(0.8), server(0.3))).toEqual(local(0.8));
  });

  it("picks server when server is further along", () => {
    expect(pickFurthestPosition(local(0.2), server(0.9))).toEqual(server(0.9));
  });

  it("returns local when only local is present", () => {
    expect(pickFurthestPosition(local(0.5), undefined)).toEqual(local(0.5));
  });

  it("returns server when only server is present", () => {
    expect(pickFurthestPosition(undefined, server(0.5))).toEqual(server(0.5));
  });

  it("returns undefined when neither is present", () => {
    expect(pickFurthestPosition(undefined, undefined)).toBeUndefined();
  });

  it("breaks an exact-percent tie by the later timestamp", () => {
    expect(
      pickFurthestPosition(
        local(0.5, "2026-01-02T00:00:00Z"),
        server(0.5, "2026-01-01T00:00:00Z"),
      ),
    ).toEqual(local(0.5, "2026-01-02T00:00:00Z"));
  });
});

describe("isMeaningfullyAhead (defect: float32 percent rounding fired a false sync offer)", () => {
  // `reading_state.percent` is Postgres `real` (float32, ~7 significant
  // digits); the local cache keeps the full JS double. Storing a double as
  // float32 rounds it — and rounds UP about half the time — so on a single
  // device the server's percent read-back is routinely a hair greater than
  // the identical local position. `Math.fround` is exactly that rounding.
  it("never treats a float32-rounded copy of the SAME position as ahead", () => {
    const percent = 0.333333333333; // an arbitrary double
    const rounded = Math.fround(percent); // what comes back from `real`
    // Rounded up (the common case for this bug) — assert the fixture is
    // actually exercising it, not coincidentally rounding down or equal.
    expect(rounded).toBeGreaterThan(percent);

    expect(
      isMeaningfullyAhead(
        { cfi: "same-cfi", percent },
        { cfi: "same-cfi", percent: rounded },
      ),
    ).toBe(false);
  });

  it("never treats the identical CFI as ahead, regardless of percent", () => {
    // Defensive: even a percent gap far bigger than any float32 artifact must
    // not count once the CFI matches — same place is same place.
    expect(
      isMeaningfullyAhead(
        { cfi: "same-cfi", percent: 0.1 },
        { cfi: "same-cfi", percent: 0.9 },
      ),
    ).toBe(false);
  });

  it("does not treat a different CFI as ahead when the percent gap is at or under the margin", () => {
    // Comfortably under the boundary (not exactly AT it) — `0.5 +
    // SYNC_OFFER_MIN_PERCENT_AHEAD` is not bit-exact in floating point, and
    // this test is about "under the margin", not about pinning down a float
    // rounding edge.
    expect(
      isMeaningfullyAhead(
        { cfi: "local-cfi", percent: 0.5 },
        { cfi: "server-cfi", percent: 0.5 + SYNC_OFFER_MIN_PERCENT_AHEAD * 0.5 },
      ),
    ).toBe(false);
  });

  it("treats a different CFI as ahead once the percent gap clears the margin", () => {
    expect(
      isMeaningfullyAhead(
        { cfi: "local-cfi", percent: 0.5 },
        { cfi: "server-cfi", percent: 0.5 + SYNC_OFFER_MIN_PERCENT_AHEAD + 0.0001 },
      ),
    ).toBe(true);
  });
});

describe("restore merges local + server (defect: offline restore lost position)", () => {
  it("restores from the local cache alone when the server is unreachable (offline)", async () => {
    vi.mocked(getReadingState).mockRejectedValue(new TypeError("Failed to fetch"));
    writeCachedPosition("book1", {
      cfi: "epubcfi(/6/99!/4/2/1:0)",
      percent: 0.55,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const c = makeController();
    const ok = await trackPosition(c, "book1").restore();

    expect(ok).toBe(true);
    expect(c.goTo).toHaveBeenCalledWith("epubcfi(/6/99!/4/2/1:0)");
  });

  it("navigates locally WITHOUT waiting on the server leg to resolve (regression: offline showed page 0 for ~5s)", async () => {
    vi.useFakeTimers();
    // Never resolves — simulates a captive portal / dead upstream link that
    // `navigator.onLine` cannot detect (see `isPlausiblyOnline`'s comment).
    vi.mocked(getReadingState).mockImplementation(() => new Promise(() => {}));
    writeCachedPosition("book1", {
      cfi: "local-cfi",
      percent: 0.5,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const c = makeController();
    const tracker = trackPosition(c, "book1");
    const ok = await tracker.restore();

    expect(ok).toBe(true);
    expect(c.goTo).toHaveBeenCalledWith("local-cfi");
    expect(c.goTo).toHaveBeenCalledTimes(1);

    // Let the bounded background reconcile time out; it must not throw, hang
    // this test, or navigate again.
    await vi.advanceTimersByTimeAsync(SERVER_LEG_TIMEOUT_MS);
    expect(c.goTo).toHaveBeenCalledTimes(1);

    tracker.stop();
    vi.useRealTimers();
  });

  it("offers, but does NOT apply, a server position that is further along than the local cache", async () => {
    // Corrected behaviour: a silent second `goTo` for a server position
    // nobody asked for is a destructive, reader-initiated-by-nobody jump
    // (docs/REVISED_PLAN.md §8(c) — a passive prompt, never silent
    // convergence). The local jump happens and stays; the server's further
    // position is only ever surfaced via `onSyncOffer`.
    vi.mocked(getReadingState).mockResolvedValue({
      book_id: "book1",
      user_id: "u1",
      cfi: "server-cfi",
      percent: 0.9,
      updated_at: "2026-01-01T00:00:00Z",
    });
    writeCachedPosition("book1", {
      cfi: "local-cfi",
      percent: 0.2,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const c = makeController();
    const tracker = trackPosition(c, "book1");
    const offers: { cfi: string }[] = [];
    tracker.onSyncOffer((offer) => offers.push(offer));

    const ok = await tracker.restore();

    expect(ok).toBe(true);
    expect(c.goTo).toHaveBeenCalledWith("local-cfi");

    await vi.waitFor(() => expect(offers).toEqual([{ cfi: "server-cfi" }]));

    // Never a second navigation for it — only the offer.
    expect(c.goTo).toHaveBeenCalledTimes(1);
    expect(c.goTo).not.toHaveBeenCalledWith("server-cfi");

    tracker.stop();
  });

  it("does not offer to continue from the same place on the same device (defect: float32 percent rounding, founder 2026-09-28)", async () => {
    // Same CFI on both sides — the single-device case this defect actually
    // hit. The server's percent is the float32 (`real`) round-trip of the
    // exact double written locally, which rounds up here (as it does about
    // half the time), so `server.percent > local.percent` even though this
    // is the identical position.
    const percent = 0.333333333333;
    const serverPercent = Math.fround(percent);
    expect(serverPercent).toBeGreaterThan(percent);

    vi.mocked(getReadingState).mockResolvedValue({
      book_id: "book1",
      user_id: "u1",
      cfi: "same-cfi",
      percent: serverPercent,
      updated_at: "2026-01-01T00:00:00Z",
    });
    writeCachedPosition("book1", {
      cfi: "same-cfi",
      percent,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const c = makeController();
    const tracker = trackPosition(c, "book1");
    const onOffer = vi.fn();
    tracker.onSyncOffer(onOffer);

    const ok = await tracker.restore();
    expect(ok).toBe(true);
    expect(c.goTo).toHaveBeenCalledWith("same-cfi");

    // Let the background reconcile finish; no offer for the place the reader
    // is already at.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    expect(onOffer).not.toHaveBeenCalled();

    tracker.stop();
  });

  it("does not offer a server position that is equal to or behind the local cache", async () => {
    vi.mocked(getReadingState).mockResolvedValue({
      book_id: "book1",
      user_id: "u1",
      cfi: "server-cfi",
      percent: 0.2,
      updated_at: "2026-01-01T00:00:00Z",
    });
    writeCachedPosition("book1", {
      cfi: "local-cfi",
      percent: 0.9,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const c = makeController();
    const tracker = trackPosition(c, "book1");
    const onOffer = vi.fn();
    tracker.onSyncOffer(onOffer);

    const ok = await tracker.restore();
    expect(ok).toBe(true);
    expect(c.goTo).toHaveBeenCalledWith("local-cfi");

    // Let any background work finish, then confirm total silence: no offer,
    // no second navigation — this is the common path and must stay quiet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    expect(onOffer).not.toHaveBeenCalled();
    expect(c.goTo).toHaveBeenCalledTimes(1);

    tracker.stop();
  });

  it("does not surface an offer once the tracker has been stopped before the server responds", async () => {
    // Cancellation: the reader tore the view down (or navigated away) before
    // the background reconcile heard back — a late reply must not conjure a
    // chip for a view that no longer exists.
    let resolveReadingState: (row: {
      book_id: string;
      user_id: string;
      cfi: string;
      percent: number;
      updated_at: string;
    }) => void = () => {};
    vi.mocked(getReadingState).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReadingState = resolve;
        }),
    );
    writeCachedPosition("book1", {
      cfi: "local-cfi",
      percent: 0.1,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const c = makeController();
    const tracker = trackPosition(c, "book1");
    const onOffer = vi.fn();
    tracker.onSyncOffer(onOffer);

    const ok = await tracker.restore();
    expect(ok).toBe(true);
    expect(c.goTo).toHaveBeenCalledWith("local-cfi");
    vi.mocked(c.goTo).mockClear();

    // Torn down before the server ever answers.
    tracker.stop();

    resolveReadingState({
      book_id: "book1",
      user_id: "u1",
      cfi: "server-cfi",
      percent: 0.9,
      updated_at: "2026-01-01T00:00:00Z",
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onOffer).not.toHaveBeenCalled();
    expect(c.goTo).not.toHaveBeenCalled();
  });

  it("suppresses the offer if the reader's own reading has already reached the offered position", async () => {
    // The reader kept turning pages while the background reconcile was in
    // flight and got there themselves — surfacing "continue from here" for
    // somewhere they already are (or have passed) would be stale, unwanted
    // interruption, not news.
    let resolveReadingState: (row: {
      book_id: string;
      user_id: string;
      cfi: string;
      percent: number;
      updated_at: string;
    }) => void = () => {};
    vi.mocked(getReadingState).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReadingState = resolve;
        }),
    );
    writeCachedPosition("book1", {
      cfi: "local-cfi",
      percent: 0.1,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const c = makeController();
    const tracker = trackPosition(c, "book1");
    const onOffer = vi.fn();
    tracker.onSyncOffer(onOffer);

    const ok = await tracker.restore();
    expect(ok).toBe(true);

    // The reader reads on, past where the server (about to answer) is.
    c._emit({ cfi: "further-cfi", percent: 0.95 });

    resolveReadingState({
      book_id: "book1",
      user_id: "u1",
      cfi: "server-cfi",
      percent: 0.9,
      updated_at: "2026-01-01T00:00:00Z",
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onOffer).not.toHaveBeenCalled();

    tracker.stop();
  });

  it("suppresses the offer when the reader's own reading is within the same tolerance of the offered position, even if not yet exactly there (defect: strict >= missed a float32-sized gap)", async () => {
    // Same tolerance as the offer's own firing condition, applied
    // symmetrically: a reader who has read to within a rounding-sized hair of
    // the server's position has, for every practical purpose, already
    // arrived — offering it as "further along" would be noise, not news.
    let resolveReadingState: (row: {
      book_id: string;
      user_id: string;
      cfi: string;
      percent: number;
      updated_at: string;
    }) => void = () => {};
    vi.mocked(getReadingState).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReadingState = resolve;
        }),
    );
    writeCachedPosition("book1", {
      cfi: "local-cfi",
      percent: 0.1,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const c = makeController();
    const tracker = trackPosition(c, "book1");
    const onOffer = vi.fn();
    tracker.onSyncOffer(onOffer);

    const ok = await tracker.restore();
    expect(ok).toBe(true);

    // The reader reads on to JUST under the server's position — closer than
    // the margin, but not equal to or past it.
    c._emit({
      cfi: "further-cfi",
      percent: 0.9 - SYNC_OFFER_MIN_PERCENT_AHEAD / 2,
    });

    resolveReadingState({
      book_id: "book1",
      user_id: "u1",
      cfi: "server-cfi",
      percent: 0.9,
      updated_at: "2026-01-01T00:00:00Z",
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onOffer).not.toHaveBeenCalled();

    tracker.stop();
  });

  it("prefers the local cache when it is further along than the server", async () => {
    vi.mocked(getReadingState).mockResolvedValue({
      book_id: "book1",
      user_id: "u1",
      cfi: "server-cfi",
      percent: 0.2,
      updated_at: "2026-01-01T00:00:00Z",
    });
    writeCachedPosition("book1", {
      cfi: "local-cfi",
      percent: 0.9,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const c = makeController();
    const ok = await trackPosition(c, "book1").restore();

    expect(ok).toBe(true);
    expect(c.goTo).toHaveBeenCalledWith("local-cfi");
  });

  it("behaves exactly as before when online with no local entry", async () => {
    vi.mocked(getReadingState).mockResolvedValue({
      book_id: "book1",
      user_id: "u1",
      cfi: "epubcfi(/6/14!/4/2/1:0)",
      percent: 0.42,
      updated_at: "2026-08-30T00:00:00Z",
    });

    const c = makeController();
    const ok = await trackPosition(c, "book1").restore();

    expect(ok).toBe(true);
    expect(c.goTo).toHaveBeenCalledWith("epubcfi(/6/14!/4/2/1:0)");
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
