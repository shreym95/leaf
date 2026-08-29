import { describe, it, expect, vi, beforeEach } from "vitest";
import { DrmProtectedError, InvalidEpubError } from "@/lib/books/ingest";

// This suite covers the ROUTE's HTTP contract: auth, path-ownership, download,
// error -> status mapping, and orphan rollback. The EPUB validation / DRM logic
// itself lives in @/lib/books/ingest and is tested in src/lib/epub/*.test.ts —
// here it is mocked.

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  registerUploadedEpub: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getUser: h.getUser }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    storage: { from: () => ({ download: h.download, remove: h.remove }) },
  })),
}));

vi.mock("@/lib/books/ingest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/books/ingest")>();
  return { ...actual, registerUploadedEpub: h.registerUploadedEpub };
});

import { POST } from "./route";

const USER_ID = "user-1";
const BOOK_ID = "11111111-1111-4111-8111-111111111111";
const PATH = `${USER_ID}/${BOOK_ID}.epub`;

const BOOK = {
  id: BOOK_ID,
  user_id: USER_ID,
  title: "Test Book",
  author: "A. Writer",
  source: "upload",
  source_ref: null,
  storage_path: PATH,
  cover_url: null,
  status: "reading",
  added_at: "2026-08-30T00:00:00Z",
};

function req(body: unknown): Request {
  return new Request("http://localhost:3000/api/books/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  h.getUser.mockReset().mockResolvedValue({ id: USER_ID });
  h.download
    .mockReset()
    .mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });
  h.remove.mockReset().mockResolvedValue({ data: [], error: null });
  h.registerUploadedEpub.mockReset().mockResolvedValue(BOOK);
});

describe("POST /api/books/register", () => {
  it("401s when not signed in", async () => {
    h.getUser.mockResolvedValue(null);
    const res = await POST(req({ path: PATH }));
    expect(res.status).toBe(401);
    expect(h.download).not.toHaveBeenCalled();
  });

  it("403s when the path is not the caller's", async () => {
    const res = await POST(req({ path: `someone-else/${BOOK_ID}.epub` }));
    expect(res.status).toBe(403);
    expect(h.download).not.toHaveBeenCalled();
  });

  it("403s when the basename is not a uuid", async () => {
    const res = await POST(req({ path: `${USER_ID}/notauuid.epub` }));
    expect(res.status).toBe(403);
  });

  it("400s on a malformed body", async () => {
    const res = await POST(req("{not json"));
    expect(res.status).toBe(400);
  });

  it("404s when the uploaded object is missing", async () => {
    h.download.mockResolvedValue({ data: null, error: { message: "not found" } });
    const res = await POST(req({ path: PATH }));
    expect(res.status).toBe(404);
    expect(h.registerUploadedEpub).not.toHaveBeenCalled();
  });

  it("rejects a DRM-protected EPUB: 422 + deletes the orphan", async () => {
    h.registerUploadedEpub.mockRejectedValue(new DrmProtectedError("rights.xml"));
    const res = await POST(req({ path: PATH }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/DRM/i);
    expect(h.remove).toHaveBeenCalledWith([PATH]);
  });

  it("rejects an invalid EPUB: 422 + deletes the orphan", async () => {
    h.registerUploadedEpub.mockRejectedValue(new InvalidEpubError("not a zip"));
    const res = await POST(req({ path: PATH }));
    expect(res.status).toBe(422);
    expect(h.remove).toHaveBeenCalledWith([PATH]);
  });

  it("500s + deletes the orphan on an unexpected failure", async () => {
    h.registerUploadedEpub.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ path: PATH }));
    expect(res.status).toBe(500);
    expect(h.remove).toHaveBeenCalledWith([PATH]);
  });

  it("accepts a clean EPUB: 201 with the book row, no cleanup", async () => {
    const res = await POST(req({ path: PATH }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: BOOK_ID, source: "upload" });
    expect(h.registerUploadedEpub).toHaveBeenCalledWith({
      userId: USER_ID,
      storagePath: PATH,
      bytes: expect.anything(),
    });
    expect(h.remove).not.toHaveBeenCalled();
  });
});
