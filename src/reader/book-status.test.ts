// The finished/unread writer. Its job beyond calling `setBookFinished` is the
// failure policy: a write made while offline must be QUEUED, not dropped —
// the defect `position.ts` has, which this module deliberately avoids by
// resolving identity from the cached session instead of `auth.getUser()`.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  demo: false,
  setBookFinished: vi.fn(async (..._a: unknown[]) => {}),
  enqueueBookStatus: vi.fn(async (..._a: unknown[]) => {}),
  getCachedUserId: vi.fn(async (): Promise<string | null> => "u1"),
  getUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/demo/flag", () => ({
  get IS_DEMO() {
    return h.demo;
  },
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: h.createClient }));
vi.mock("@/lib/db/book-status", () => ({ setBookFinished: h.setBookFinished }));
vi.mock("@/lib/offline/outbox", async (importOriginal) => {
  // `classifyWriteFailure` stays real: the point is that a genuine
  // offline-shaped error is classified as transport and queued.
  const actual = await importOriginal<typeof import("@/lib/offline/outbox")>();
  return {
    ...actual,
    enqueueBookStatus: h.enqueueBookStatus,
    getCachedUserId: h.getCachedUserId,
  };
});

import { recordFinished, recordUnread } from "./book-status";

const CLIENT = { auth: { getUser: h.getUser } };

beforeEach(() => {
  vi.clearAllMocks();
  h.demo = false;
  h.getCachedUserId.mockResolvedValue("u1");
  h.setBookFinished.mockResolvedValue(undefined);
  h.enqueueBookStatus.mockResolvedValue(undefined);
  h.createClient.mockReturnValue(CLIENT);
});

describe("recordFinished / recordUnread", () => {
  it("writes finished with an ISO timestamp using the cached user id", async () => {
    await recordFinished("book-1");

    expect(h.setBookFinished).toHaveBeenCalledTimes(1);
    const [userId, bookId, finishedAt, client] = h.setBookFinished.mock.calls[0];
    expect(userId).toBe("u1");
    expect(bookId).toBe("book-1");
    expect(finishedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(client).toBe(CLIENT);
    expect(h.enqueueBookStatus).not.toHaveBeenCalled();
  });

  it("writes unread as null", async () => {
    await recordUnread("book-1");
    expect(h.setBookFinished).toHaveBeenCalledWith("u1", "book-1", null, CLIENT);
  });

  it("never asks the auth server who the user is (that call fails offline)", async () => {
    await recordFinished("book-1");
    expect(h.getUser).not.toHaveBeenCalled();
  });
});

describe("offline", () => {
  // What postgrest-js hands back for a dead network: an error with an EMPTY
  // `code` (it caught a fetch TypeError) — see `classifyWriteFailure`.
  const offlineError = { message: "TypeError: Failed to fetch", code: "" };

  it("QUEUES a write that failed for connectivity instead of dropping it", async () => {
    h.setBookFinished.mockRejectedValueOnce(offlineError);

    await recordFinished("book-1");

    expect(h.enqueueBookStatus).toHaveBeenCalledTimes(1);
    const [userId, bookId, finishedAt] = h.enqueueBookStatus.mock.calls[0];
    expect([userId, bookId]).toEqual(["u1", "book-1"]);
    expect(typeof finishedAt).toBe("string");
  });

  it("queues an unread write the same way, carrying null", async () => {
    h.setBookFinished.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await recordUnread("book-1");
    expect(h.enqueueBookStatus).toHaveBeenCalledWith("u1", "book-1", null);
  });

  it("queues even though auth.getUser() would report no user (the offline shape)", async () => {
    // auth-js offline: `{ user: null, error }`, not a throw. A writer that
    // gated on it would see "signed out" and drop; this one must not look.
    h.getUser.mockResolvedValue({ data: { user: null }, error: new Error("offline") });
    h.setBookFinished.mockRejectedValueOnce(offlineError);

    await recordFinished("book-1");

    expect(h.enqueueBookStatus).toHaveBeenCalledTimes(1);
  });

  it("drops a rejection (RLS, bad data) — retrying could never succeed", async () => {
    h.setBookFinished.mockRejectedValueOnce({ code: "42501", message: "denied" });
    await recordFinished("book-1");
    expect(h.enqueueBookStatus).not.toHaveBeenCalled();
  });
});

describe("never throws, and does nothing it should not", () => {
  it("drops the write when signed out (no cached user)", async () => {
    h.getCachedUserId.mockResolvedValue(null);
    await expect(recordFinished("book-1")).resolves.toBeUndefined();
    expect(h.setBookFinished).not.toHaveBeenCalled();
    expect(h.enqueueBookStatus).not.toHaveBeenCalled();
  });

  it("is a no-op in demo mode", async () => {
    h.demo = true;
    await recordFinished("book-1");
    await recordUnread("book-1");
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.setBookFinished).not.toHaveBeenCalled();
    expect(h.enqueueBookStatus).not.toHaveBeenCalled();
  });

  it("swallows a missing Supabase config", async () => {
    h.createClient.mockImplementation(() => {
      throw new Error("not configured");
    });
    await expect(recordFinished("book-1")).resolves.toBeUndefined();
  });

  it("swallows a failing outbox", async () => {
    h.setBookFinished.mockRejectedValueOnce({ message: "Failed to fetch", code: "" });
    h.enqueueBookStatus.mockRejectedValueOnce(new Error("idb gone"));
    await expect(recordFinished("book-1")).resolves.toBeUndefined();
  });
});
