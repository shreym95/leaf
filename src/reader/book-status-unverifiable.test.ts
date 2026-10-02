// recordFinished with the REAL identity resolution (`getCachedUserId` is NOT
// mocked here, unlike book-status.test.ts). Offline after the access token has
// expired, auth-js resolves `{ session: null, error: AuthRetryableFetchError }`;
// the finish must still be QUEUED against the device's owner marker rather
// than dropped as if the reader were signed out.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRetryableFetchError } from "@supabase/supabase-js";

const h = vi.hoisted(() => ({
  setBookFinished: vi.fn(async (..._a: unknown[]) => {}),
  enqueueBookStatus: vi.fn(async (..._a: unknown[]) => {}),
  getSession: vi.fn(),
}));

vi.mock("@/lib/demo/flag", () => ({ IS_DEMO: false }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: h.getSession } }),
}));
vi.mock("@/lib/db/book-status", () => ({ setBookFinished: h.setBookFinished }));
vi.mock("@/lib/offline/outbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/outbox")>();
  return { ...actual, enqueueBookStatus: h.enqueueBookStatus };
});

import { OWNER_MARKER_KEY } from "@/lib/offline/identity";
import { recordFinished } from "./book-status";

const offlineWrite = { message: "TypeError: Failed to fetch", code: "" };
const unverifiable = () => ({
  data: { session: null },
  error: new AuthRetryableFetchError("Failed to fetch", 0),
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  h.setBookFinished.mockResolvedValue(undefined);
  h.enqueueBookStatus.mockResolvedValue(undefined);
});

describe("recordFinished — session unverifiable (expired token, offline)", () => {
  it("queues the finish against the owner marker's id", async () => {
    window.localStorage.setItem(OWNER_MARKER_KEY, "marker-user");
    h.getSession.mockResolvedValue(unverifiable());
    h.setBookFinished.mockRejectedValueOnce(offlineWrite);

    await recordFinished("book-1");

    expect(h.enqueueBookStatus).toHaveBeenCalledTimes(1);
    const [userId, bookId, finishedAt] = h.enqueueBookStatus.mock.calls[0];
    expect([userId, bookId]).toEqual(["marker-user", "book-1"]);
    expect(typeof finishedAt).toBe("string");
  });

  it("drops the write when unverifiable and there is no marker (nothing to scope it to)", async () => {
    h.getSession.mockResolvedValue(unverifiable());

    await recordFinished("book-1");

    expect(h.setBookFinished).not.toHaveBeenCalled();
    expect(h.enqueueBookStatus).not.toHaveBeenCalled();
  });

  it("still drops the write on a real sign-out, marker or not", async () => {
    window.localStorage.setItem(OWNER_MARKER_KEY, "marker-user");
    h.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await recordFinished("book-1");

    expect(h.setBookFinished).not.toHaveBeenCalled();
    expect(h.enqueueBookStatus).not.toHaveBeenCalled();
  });
});
