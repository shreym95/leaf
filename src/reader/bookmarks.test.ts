// Bookmark manager (Phase 2) — the same core promise as highlights: a bookmark
// saved in one session comes back, keyed by CFI, on the next restore (any
// device). The db layer + Supabase client are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/bookmarks", () => ({
  listBookmarks: vi.fn(async () => []),
  createBookmark: vi.fn(),
  deleteBookmark: vi.fn(async () => {}),
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
  cancelQueuedBookmarkCreate: vi.fn(async () => true),
  classifyWriteFailure: vi.fn(() => "transport"),
  enqueueBookmarkCreate: vi.fn(async () => {}),
  enqueueBookmarkDelete: vi.fn(async () => {}),
  resolveUserId: vi.fn(async () => "u1"),
}));

import {
  createBookmark,
  deleteBookmark,
  listBookmarks,
} from "@/lib/db/bookmarks";
import type { Bookmark } from "@/lib/types";
import {
  cancelQueuedBookmarkCreate,
  classifyWriteFailure,
  enqueueBookmarkCreate,
  enqueueBookmarkDelete,
} from "@/lib/offline/outbox";
import { manageBookmarks } from "./bookmarks";

const ROW = (over: Partial<Bookmark> = {}): Bookmark => ({
  id: "bm-1",
  book_id: "book1",
  user_id: "u1",
  cfi: "epubcfi(/6/14!/4/2/1:0)",
  label: "Chapter 1",
  percent: 0.12,
  created_at: "2026-09-09T00:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` resets call history but not implementations set with
  // `mockResolvedValue` / `mockReturnValue` — reset the outbox mocks to sane
  // defaults so one test's failure-path setup can't leak into the next.
  vi.mocked(classifyWriteFailure).mockReturnValue("transport");
  vi.mocked(cancelQueuedBookmarkCreate).mockResolvedValue(true);
});

describe("create", () => {
  it("persists the bookmark with its CFI, denormalised label and percent", async () => {
    vi.mocked(createBookmark).mockResolvedValue(ROW());
    const mgr = manageBookmarks("book1");

    const rec = await mgr.create({
      cfi: "epubcfi(/6/14!/4/2/1:0)",
      label: "Chapter 1",
      percent: 0.12,
    });

    expect(createBookmark).toHaveBeenCalledWith(
      "u1",
      {
        bookId: "book1",
        cfi: "epubcfi(/6/14!/4/2/1:0)",
        label: "Chapter 1",
        percent: 0.12,
      },
      expect.anything(),
    );
    expect(rec.id).toBe("bm-1");
    expect(mgr.list()).toHaveLength(1);
  });

  it("passes null through for an unknown label / percent", async () => {
    vi.mocked(createBookmark).mockImplementation(async (_userId, input) =>
      ROW({ cfi: input.cfi, label: input.label ?? null, percent: input.percent ?? null }),
    );
    const mgr = manageBookmarks("book1");

    await mgr.create({ cfi: "cfi-x" });

    expect(createBookmark).toHaveBeenCalledWith(
      "u1",
      { bookId: "book1", cfi: "cfi-x", label: null, percent: null },
      expect.anything(),
    );
  });

  it("does not throw when the db write fails, tracks the bookmark locally, and QUEUES the write for replay (was: silently dropped)", async () => {
    vi.mocked(createBookmark).mockRejectedValue(new Error("network down"));
    const mgr = manageBookmarks("book1");

    const rec = await mgr.create({ cfi: "cfi-y" });

    expect(rec.cfi).toBe("cfi-y");
    expect(mgr.list()).toHaveLength(1);
    expect(enqueueBookmarkCreate).toHaveBeenCalledWith("u1", {
      localId: rec.id,
      bookId: "book1",
      cfi: "cfi-y",
      label: null,
      percent: null,
    });
  });

  it("does NOT queue when the failure is a rejection (RLS / bad data), not a transport failure", async () => {
    vi.mocked(classifyWriteFailure).mockReturnValue("rejected");
    vi.mocked(createBookmark).mockRejectedValue({ code: "42501" });
    const mgr = manageBookmarks("book1");

    await mgr.create({ cfi: "cfi-z" });

    expect(enqueueBookmarkCreate).not.toHaveBeenCalled();
  });
});

describe("restore — the CFI round-trip", () => {
  it("a fresh manager reads persisted bookmarks back", async () => {
    const table: Bookmark[] = [];
    vi.mocked(createBookmark).mockImplementation(async (_userId, input) => {
      const row = ROW({
        id: `bm-${table.length + 1}`,
        cfi: input.cfi,
        label: input.label ?? null,
        percent: input.percent ?? null,
      });
      table.push(row);
      return row;
    });
    vi.mocked(listBookmarks).mockImplementation(async () => [...table]);

    const CFI_A = "epubcfi(/6/22!/4/2/8/1:0)";
    const CFI_B = "epubcfi(/6/24!/4/2/2/1:5)";

    const mgr1 = manageBookmarks("book1");
    await mgr1.create({ cfi: CFI_A, label: "One", percent: 0.2 });
    await mgr1.create({ cfi: CFI_B, label: "Two", percent: 0.5 });
    mgr1.stop();

    const mgr2 = manageBookmarks("book1");
    const restored = await mgr2.restore();

    expect(restored.map((r) => r.cfi)).toEqual([CFI_A, CFI_B]);
    expect(restored.map((r) => r.label)).toEqual(["One", "Two"]);
  });

  it("keeps the current list when the db read fails", async () => {
    vi.mocked(listBookmarks).mockRejectedValue(new Error("boom"));
    const mgr = manageBookmarks("book1");
    await expect(mgr.restore()).resolves.toEqual([]);
  });
});

describe("remove", () => {
  it("deletes from the db and drops it from the in-memory list", async () => {
    vi.mocked(listBookmarks).mockResolvedValue([ROW()]);
    const mgr = manageBookmarks("book1");
    await mgr.restore();

    await mgr.remove("bm-1");

    expect(deleteBookmark).toHaveBeenCalledWith("u1", "bm-1", expect.anything());
    expect(mgr.list()).toHaveLength(0);
  });

  it("does not throw when the db delete fails, and QUEUES the delete for replay (was: silently dropped)", async () => {
    vi.mocked(listBookmarks).mockResolvedValue([ROW()]);
    vi.mocked(deleteBookmark).mockRejectedValue(new Error("boom"));
    const mgr = manageBookmarks("book1");
    await mgr.restore();

    await expect(mgr.remove("bm-1")).resolves.toBeUndefined();
    expect(mgr.list()).toHaveLength(0);
    expect(enqueueBookmarkDelete).toHaveBeenCalledWith("u1", "bm-1");
  });

  it("does NOT queue a delete failure that is a rejection, not a transport failure", async () => {
    vi.mocked(listBookmarks).mockResolvedValue([ROW()]);
    vi.mocked(classifyWriteFailure).mockReturnValue("rejected");
    vi.mocked(deleteBookmark).mockRejectedValue({ code: "42501" });
    const mgr = manageBookmarks("book1");
    await mgr.restore();

    await mgr.remove("bm-1");

    expect(enqueueBookmarkDelete).not.toHaveBeenCalled();
  });

  it("removing a bookmark that never synced (local id) cancels the queued create instead of deleting on the server", async () => {
    vi.mocked(createBookmark).mockRejectedValue(new Error("offline"));
    const mgr = manageBookmarks("book1");
    const rec = await mgr.create({ cfi: "cfi-local" }); // create fails -> queued, local id kept

    await mgr.remove(rec.id);

    expect(cancelQueuedBookmarkCreate).toHaveBeenCalledWith("u1", rec.id);
    expect(deleteBookmark).not.toHaveBeenCalled();
    expect(enqueueBookmarkDelete).not.toHaveBeenCalled();
    expect(mgr.list()).toHaveLength(0);
  });
});

describe("subscribe / stop", () => {
  it("notifies on create and remove, and stops after stop()", async () => {
    vi.mocked(createBookmark).mockResolvedValue(ROW());
    const mgr = manageBookmarks("book1");

    const counts: number[] = [];
    const unsub = mgr.subscribe((list) => counts.push(list.length));

    await mgr.create({ cfi: ROW().cfi });
    expect(counts.at(-1)).toBe(1);

    unsub();
    await mgr.remove("bm-1");
    expect(counts).toEqual([1]);
  });
});
