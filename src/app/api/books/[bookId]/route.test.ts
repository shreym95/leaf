import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  book: null as unknown,
  lookupError: null as unknown,
  remove: vi.fn(),
  del: vi.fn(),
  setArchived: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getUser: h.getUser }));
vi.mock("@/lib/db/books", () => ({ setBookArchived: h.setArchived }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    storage: { from: () => ({ remove: h.remove }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: h.book, error: h.lookupError }),
          }),
        }),
      }),
      delete: () => ({ eq: () => ({ eq: h.del }) }),
    }),
  })),
}));

import { PATCH, DELETE } from "./route";

const params = Promise.resolve({ bookId: "b1" });
const patchReq = (body: unknown) =>
  new Request("http://localhost/api/books/b1", {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.getUser.mockResolvedValue({ id: "u1" });
  h.lookupError = null;
  h.book = {
    id: "b1",
    user_id: "u1",
    title: "T",
    storage_path: "u1/b1.epub",
    cover_path: "u1/b1-cover.jpg",
  };
  h.remove.mockResolvedValue({ error: null });
  h.del.mockResolvedValue({ error: null });
  h.setArchived.mockResolvedValue(undefined);
});

describe("PATCH /api/books/:id", () => {
  it("401s when signed out", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await PATCH(patchReq({ archived: true }), { params })).status).toBe(401);
  });

  it("hides and restores, always for the session's own user", async () => {
    await PATCH(patchReq({ archived: true }), { params });
    expect(h.setArchived).toHaveBeenCalledWith("u1", "b1", true);

    await PATCH(patchReq({ archived: false }), { params });
    expect(h.setArchived).toHaveBeenCalledWith("u1", "b1", false);
  });

  it("rejects a non-boolean or malformed body", async () => {
    expect((await PATCH(patchReq({ archived: "yes" }), { params })).status).toBe(400);
    expect((await PATCH(patchReq("{oops"), { params })).status).toBe(400);
  });
});

describe("DELETE /api/books/:id", () => {
  const req = new Request("http://localhost/api/books/b1", { method: "DELETE" });

  it("401s when signed out", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await DELETE(req, { params })).status).toBe(401);
  });

  it("404s for a book that isn't the caller's", async () => {
    h.book = null;
    expect((await DELETE(req, { params })).status).toBe(404);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("removes the file and the cover, then the row", async () => {
    const res = await DELETE(req, { params });
    expect(res.status).toBe(200);
    expect(h.remove).toHaveBeenCalledWith(["u1/b1.epub", "u1/b1-cover.jpg"]);
    expect(h.del).toHaveBeenCalled();
  });

  it("keeps the row when the files could not be removed", async () => {
    // An orphaned row is visible and fixable; an orphaned file is invisible and
    // bills the reader's storage forever. So files go first, and a failure stops
    // everything rather than half-deleting.
    h.remove.mockResolvedValue({ error: { message: "storage down" } });

    const res = await DELETE(req, { params });

    expect(res.status).toBe(500);
    expect(h.del).not.toHaveBeenCalled();
  });

  it("copes with a book that has no cover", async () => {
    h.book = { ...(h.book as object), cover_path: null };
    await DELETE(req, { params });
    expect(h.remove).toHaveBeenCalledWith(["u1/b1.epub"]);
  });
});
