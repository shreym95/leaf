// Sync-offer rule, newest-write-wins (`shouldOfferServer` in `position.ts`):
// the server row is offered only when it was written AFTER the local cache
// entry, and the two positions differ by more than
// `SYNC_OFFER_MIN_PERCENT_AHEAD` in either direction. The db layer + Supabase
// client are mocked; the local cache is real jsdom localStorage.

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

import { getReadingState } from "@/lib/db/reading-state";
import type { ReaderController } from "./engine";
import { trackPosition } from "./position";
import { writeCachedPosition } from "./position-cache";

type RelocatedCb = (loc: { cfi: string; percent: number }) => void;

type ServerRow = {
  book_id: string;
  user_id: string;
  cfi: string;
  percent: number;
  updated_at: string;
};

const T_10_00 = "2026-01-01T10:00:00Z";
const T_10_05 = "2026-01-01T10:05:00Z";

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

function serverRow(cfi: string, percent: number, updatedAt: string): ServerRow {
  return { book_id: "book1", user_id: "u1", cfi, percent, updated_at: updatedAt };
}

// Lets the background reconcile run to completion: it awaits the mocked
// server read through a bounded `withTimeout`, so a macrotask turn is enough.
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // Every test uses bookId "book1"; clear the real localStorage cache so one
  // test's local entry can't leak into the next.
  window.localStorage.clear();
});

describe("sync offer: newest write wins", () => {
  it("does NOT offer a server position behind the local cache when the local write is newer (founder bug)", async () => {
    vi.mocked(getReadingState).mockResolvedValue(
      serverRow("server-cfi", 0.3, T_10_00),
    );
    writeCachedPosition("book1", {
      cfi: "local-cfi",
      percent: 0.1,
      updatedAt: T_10_05,
    });

    const c = makeController();
    const tracker = trackPosition(c, "book1");
    const offers: { cfi: string }[] = [];
    tracker.onSyncOffer((offer) => offers.push(offer));

    const ok = await tracker.restore();
    expect(ok).toBe(true);
    expect(c.goTo).toHaveBeenCalledWith("local-cfi");

    await settle();
    expect(offers).toEqual([]);

    tracker.stop();
  });

  it("offers a server position behind the local cache when the server write is newer (another device went back)", async () => {
    vi.mocked(getReadingState).mockResolvedValue(
      serverRow("server-cfi", 0.1, T_10_05),
    );
    writeCachedPosition("book1", {
      cfi: "local-cfi",
      percent: 0.3,
      updatedAt: T_10_00,
    });

    const c = makeController();
    const tracker = trackPosition(c, "book1");
    const offers: { cfi: string }[] = [];
    tracker.onSyncOffer((offer) => offers.push(offer));

    expect(await tracker.restore()).toBe(true);
    expect(c.goTo).toHaveBeenCalledWith("local-cfi");

    await vi.waitFor(() => expect(offers).toEqual([{ cfi: "server-cfi" }]));
    expect(c.goTo).toHaveBeenCalledTimes(1);

    tracker.stop();
  });

  it("offers a server position further along when the server write is newer", async () => {
    vi.mocked(getReadingState).mockResolvedValue(
      serverRow("server-cfi", 0.3, T_10_05),
    );
    writeCachedPosition("book1", {
      cfi: "local-cfi",
      percent: 0.1,
      updatedAt: T_10_00,
    });

    const c = makeController();
    const tracker = trackPosition(c, "book1");
    const offers: { cfi: string }[] = [];
    tracker.onSyncOffer((offer) => offers.push(offer));

    expect(await tracker.restore()).toBe(true);
    expect(c.goTo).toHaveBeenCalledWith("local-cfi");

    await vi.waitFor(() => expect(offers).toEqual([{ cfi: "server-cfi" }]));
    expect(c.goTo).toHaveBeenCalledTimes(1);

    tracker.stop();
  });

  it("does not offer the same CFI on the same device, even when the server write is newer", async () => {
    vi.mocked(getReadingState).mockResolvedValue(
      serverRow("same-cfi", 0.5, T_10_05),
    );
    writeCachedPosition("book1", {
      cfi: "same-cfi",
      percent: 0.5,
      updatedAt: T_10_00,
    });

    const c = makeController();
    const tracker = trackPosition(c, "book1");
    const offers: { cfi: string }[] = [];
    tracker.onSyncOffer((offer) => offers.push(offer));

    expect(await tracker.restore()).toBe(true);

    await settle();
    expect(offers).toEqual([]);

    tracker.stop();
  });

  it("suppresses the offer when the reader already sits within the margin of the server position", async () => {
    // Server is newer and well ahead, so the timestamp rule alone would
    // offer. The reader reaches (within 0.005 of) the server's percent while
    // the server read is in flight: the offer must be suppressed.
    let resolveRow: (row: ServerRow) => void = () => {};
    vi.mocked(getReadingState).mockImplementation(
      () =>
        new Promise<ServerRow>((resolve) => {
          resolveRow = resolve;
        }),
    );
    writeCachedPosition("book1", {
      cfi: "local-cfi",
      percent: 0.1,
      updatedAt: T_10_00,
    });

    const c = makeController();
    const tracker = trackPosition(c, "book1");
    const offers: { cfi: string }[] = [];
    tracker.onSyncOffer((offer) => offers.push(offer));

    expect(await tracker.restore()).toBe(true);

    c._emit({ cfi: "near-cfi", percent: 0.502 });

    resolveRow(serverRow("server-cfi", 0.5, T_10_05));
    await settle();

    expect(offers).toEqual([]);

    tracker.stop();
  });
});
