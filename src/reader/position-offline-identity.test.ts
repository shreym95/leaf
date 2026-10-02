// Position flush when the Auth server is unreachable. auth-js RESOLVES
// `{ data: { user: null }, error: AuthRetryableFetchError }` offline rather
// than throwing; the server sync must still be queued, not silently dropped.
// Signed-out (no session) must still write and queue nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";

vi.mock("@/lib/db/reading-state", () => ({
  getReadingState: vi.fn(),
  upsertReadingState: vi.fn(async () => {}),
}));

const auth = {
  getUser: vi.fn(),
  getSession: vi.fn(),
};
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({ auth })),
}));

vi.mock("@/lib/offline/outbox", async (importOriginal) => {
  // Real `resolveUserId` / `getCachedUserId` / `classifyWriteFailure` — the
  // identity resolution is the thing under test. Only the IndexedDB append
  // is stubbed.
  const actual = await importOriginal<typeof import("@/lib/offline/outbox")>();
  return { ...actual, enqueueReadingState: vi.fn(async () => {}) };
});

import { upsertReadingState } from "@/lib/db/reading-state";
import { enqueueReadingState } from "@/lib/offline/outbox";
import type { ReaderController } from "./engine";
import { trackPosition } from "./position";

type RelocatedCb = (loc: { cfi: string; percent: number }) => void;

function makeController(): ReaderController & { _emit: RelocatedCb } {
  const subs = new Set<RelocatedCb>();
  return {
    onRelocated: vi.fn((cb: RelocatedCb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    }),
    goTo: vi.fn(async () => {}),
    destroy: vi.fn(),
    sectionCount: 0,
    _emit: (loc: { cfi: string; percent: number }) => subs.forEach((cb) => cb(loc)),
  } as unknown as ReaderController & { _emit: RelocatedCb };
}

async function flushOnce(): Promise<void> {
  vi.useFakeTimers();
  const c = makeController();
  trackPosition(c, "book1", { debounceMs: 1500 });
  c._emit({ cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.42 });
  await vi.advanceTimersByTimeAsync(1500);
  vi.useRealTimers();
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(upsertReadingState).mockResolvedValue(undefined);
});

describe("flush with the Auth server unreachable", () => {
  it("queues the write against the cached session id", async () => {
    auth.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    vi.mocked(upsertReadingState).mockRejectedValue(new TypeError("Failed to fetch"));

    await flushOnce();

    expect(enqueueReadingState).toHaveBeenCalledWith(
      "u1",
      "book1",
      { cfi: "epubcfi(/6/14!/4/2/1:0)", percent: 0.42 },
    );
  });

  it("writes and queues nothing when there is no cached session", async () => {
    auth.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    auth.getSession.mockResolvedValue({ data: { session: null } });

    await flushOnce();

    expect(upsertReadingState).not.toHaveBeenCalled();
    expect(enqueueReadingState).not.toHaveBeenCalled();
  });
});

describe("flush when signed out", () => {
  it("writes and queues nothing on a session-missing error, even with a stale cached session", async () => {
    auth.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "stale" } } } });

    await flushOnce();

    expect(upsertReadingState).not.toHaveBeenCalled();
    expect(enqueueReadingState).not.toHaveBeenCalled();
  });
});
