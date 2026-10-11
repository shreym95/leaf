import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/groups/server/fake-admin.testkit";
import { buildOutline } from "@/lib/groups/outline";
import { toStoredOutline } from "@/lib/groups/server/reads";
import { extractEpubToc } from "@/lib/groups/server/toc";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_GROUP = "abababab-abab-4bab-8bab-abababababab";
const READ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UPLOAD_READ = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MY_BOOK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MY_OTHER_BOOK = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const THEIR_BOOK = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ARCHIVED_BOOK = "99999999-9999-4999-8999-999999999999";

const h = vi.hoisted(() => ({
  enabled: true,
  getUser: vi.fn(),
  ingest: vi.fn(),
  fetchSe: vi.fn(),
  fetchPg: vi.fn(),
  db: null as unknown as { client(): unknown },
}));

vi.mock("@/lib/groups/flag", () => ({
  get GROUPS_ENABLED() {
    return h.enabled;
  },
}));
vi.mock("@/lib/auth", () => ({ getUser: h.getUser }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => h.db.client(),
}));
vi.mock("@/lib/books/ingest", () => ({ ingestEpub: h.ingest }));
vi.mock("@/lib/import/standard-ebooks", () => ({
  fetchStandardEbooksEpub: h.fetchSe,
}));
vi.mock("@/lib/import/gutendex", () => ({ fetchGutenbergEpub: h.fetchPg }));

import { POST } from "./route";

const bundled = (name: string) => readFileSync(`public/bundled/${name}.epub`);
const FRANKENSTEIN = bundled("frankenstein");
const TIME_MACHINE = bundled("time-machine");

let db: FakeDb;
let outline: unknown;

const post = (
  body?: unknown,
  ids: { groupId?: string; readId?: string } = {},
) => {
  const groupId = ids.groupId ?? GROUP;
  const readId = ids.readId ?? READ;
  return POST(
    new Request(`http://localhost/api/groups/${groupId}/reads/${readId}/copy`, {
      method: "POST",
      body:
        body === undefined
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body),
    }),
    { params: Promise.resolve({ groupId, readId }) },
  );
};

const copies = () => db.rows("read_copies");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.enabled = true;
  h.getUser.mockResolvedValue({ id: ME });
  h.fetchSe.mockResolvedValue(FRANKENSTEIN);
  h.fetchPg.mockResolvedValue(FRANKENSTEIN);
  h.ingest.mockImplementation(async (p: { userId: string; source: string; sourceRef: string }) => {
    const id = "11110000-0000-4000-8000-000000000001";
    db.seed("books", {
      id,
      user_id: p.userId,
      source: p.source,
      source_ref: p.sourceRef,
      storage_path: `${p.userId}/${id}.epub`,
      archived_at: null,
      added_at: "2026-01-01",
    });
    db.files.set(`${p.userId}/${id}.epub`, new Uint8Array(FRANKENSTEIN));
    return { id };
  });

  outline = toStoredOutline(buildOutline(await extractEpubToc(FRANKENSTEIN)));
  db = new FakeDb();
  db.seed(
    "group_members",
    { group_id: GROUP, user_id: ME, role: "member" },
    { group_id: GROUP, user_id: OTHER, role: "owner" },
    { group_id: OTHER_GROUP, user_id: STRANGER, role: "owner" },
  );
  db.seed(
    "group_reads",
    { id: READ, group_id: GROUP, title: "Frankenstein", author: "", source: "standardebooks", source_ref: "mary-shelley/frankenstein", outline },
    { id: UPLOAD_READ, group_id: GROUP, title: "Mine", author: "", source: "upload", source_ref: null, outline },
  );
  const own = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    user_id: ME,
    source: "standardebooks",
    source_ref: "mary-shelley/frankenstein",
    storage_path: `${ME}/${id}.epub`,
    archived_at: null,
    added_at: "2025-01-01",
    ...extra,
  });
  db.seed(
    "books",
    own(MY_BOOK),
    own(MY_OTHER_BOOK, { source: "upload", source_ref: null }),
    own(ARCHIVED_BOOK, { archived_at: "2026-01-01", added_at: "2024-01-01" }),
    { ...own(THEIR_BOOK), user_id: OTHER, storage_path: `${OTHER}/${THEIR_BOOK}.epub` },
  );
  db.files.set(`${ME}/${MY_BOOK}.epub`, new Uint8Array(FRANKENSTEIN));
  db.files.set(`${ME}/${MY_OTHER_BOOK}.epub`, new Uint8Array(TIME_MACHINE));
  db.files.set(`${ME}/${ARCHIVED_BOOK}.epub`, new Uint8Array(FRANKENSTEIN));
  db.files.set(`${OTHER}/${THEIR_BOOK}.epub`, new Uint8Array(FRANKENSTEIN));
  h.db = db;
});

describe("POST /api/groups/:groupId/reads/:readId/copy", () => {
  it("404s when groups are off", async () => {
    h.enabled = false;
    expect((await post()).status).toBe(404);
    expect(copies()).toHaveLength(0);
  });

  it("401s when signed out", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
  });

  it("403s for a non-member", async () => {
    h.getUser.mockResolvedValue({ id: STRANGER });
    expect((await post()).status).toBe(403);
    expect(copies()).toHaveLength(0);
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it("404s for a read in another group", async () => {
    db.rows("group_reads")[0].group_id = OTHER_GROUP;
    expect((await post()).status).toBe(404);
  });

  it("404s for a read that does not exist or an id that is not a uuid", async () => {
    expect((await post(undefined, { readId: "99999999-0000-4000-8000-000000000000" })).status).toBe(404);
    expect((await post(undefined, { readId: "nope" })).status).toBe(404);
  });

  it.each([
    ["malformed json", "{nope"],
    ["a json array", "[]"],
    ["bookId not a uuid", { bookId: "abc" }],
    ["bookId a number", { bookId: 4 }],
  ])("400s on invalid input (%s)", async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(copies()).toHaveLength(0);
  });

  describe("catalog read without a bookId", () => {
    it("links the caller's own non-archived copy and aligns it, without importing", async () => {
      const res = await post();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ linked: true, imported: false, alignment: { confidence: 1 } });
      expect(h.ingest).not.toHaveBeenCalled();
      expect(copies()).toHaveLength(1);
      expect(copies()[0]).toMatchObject({
        read_id: READ,
        user_id: ME,
        book_id: MY_BOOK,
        content_sha256: createHash("sha256").update(FRANKENSTEIN).digest("hex"),
      });
      expect(copies()[0].alignment).toMatchObject({ confidence: 1 });
      expect(Object.keys((copies()[0].alignment as { map: object }).map).length).toBeGreaterThan(30);
    });

    it("imports for the caller when they have no live copy, then aligns", async () => {
      db.tables.books = db.rows("books").filter((b) => b.user_id !== ME || b.archived_at !== null);
      const res = await post();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ linked: true, imported: true, alignment: { confidence: 1 } });
      expect(h.ingest).toHaveBeenCalledTimes(1);
      expect(h.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ME, source: "standardebooks", sourceRef: "mary-shelley/frankenstein" }),
      );
      expect(copies()[0]).toMatchObject({ user_id: ME, book_id: "11110000-0000-4000-8000-000000000001" });
    });

    it("answers 502 and links nothing when the import fails", async () => {
      db.tables.books = db.rows("books").filter((b) => b.user_id !== ME);
      h.fetchSe.mockRejectedValue(new Error("network down"));
      const res = await post();
      expect(res.status).toBe(502);
      expect(copies()).toHaveLength(0);
    });

    it("400s for an uploaded read, which has nothing to look up", async () => {
      const res = await post(undefined, { readId: UPLOAD_READ });
      expect(res.status).toBe(400);
      expect(copies()).toHaveLength(0);
    });
  });

  describe("with a bookId", () => {
    it("links the caller's own book and reports how well it lines up", async () => {
      const res = await post({ bookId: MY_OTHER_BOOK });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ linked: true, imported: false });
      expect(body.alignment.confidence).toBeLessThan(0.5);
      expect(copies()[0]).toMatchObject({ book_id: MY_OTHER_BOOK, user_id: ME });
      expect(h.ingest).not.toHaveBeenCalled();
    });

    it("works for an uploaded read", async () => {
      const res = await post({ bookId: MY_BOOK }, { readId: UPLOAD_READ });
      expect(res.status).toBe(200);
      expect(copies()[0]).toMatchObject({ read_id: UPLOAD_READ, book_id: MY_BOOK });
    });

    it("404s for someone else's book and links nothing", async () => {
      const res = await post({ bookId: THEIR_BOOK });
      expect(res.status).toBe(404);
      expect(copies()).toHaveLength(0);
    });

    it("404s for a book that does not exist", async () => {
      const res = await post({ bookId: "99999999-9999-4999-8999-999999999990" });
      expect(res.status).toBe(404);
    });

    it("moves an existing link to the book the caller chose", async () => {
      db.seed("read_copies", { read_id: READ, user_id: ME, book_id: MY_BOOK, content_sha256: "old", alignment: { confidence: 1 } });
      const res = await post({ bookId: MY_OTHER_BOOK });
      expect(res.status).toBe(200);
      expect(copies()).toHaveLength(1);
      expect(copies()[0]).toMatchObject({
        book_id: MY_OTHER_BOOK,
        content_sha256: createHash("sha256").update(TIME_MACHINE).digest("hex"),
      });
    });
  });

  describe("alignment failure", () => {
    it("links with a null alignment when the EPUB cannot be read, and still answers 200", async () => {
      db.files.set(`${ME}/${MY_BOOK}.epub`, new Uint8Array([1, 2, 3]));
      const res = await post();
      expect(res.status).toBe(200);
      expect((await res.json()).alignment).toBeNull();
      expect(copies()[0]).toMatchObject({ book_id: MY_BOOK, alignment: null });
    });

    it("links with a null alignment when the file is missing from storage", async () => {
      db.files.delete(`${ME}/${MY_BOOK}.epub`);
      const res = await post();
      expect(res.status).toBe(200);
      expect(copies()[0]).toMatchObject({ book_id: MY_BOOK, alignment: null });
    });
  });

  describe("repeating the call", () => {
    it("does nothing the second time when the alignment is already stored", async () => {
      await post();
      const before = structuredClone(copies());
      db.updates.length = 0;
      db.files.delete(`${ME}/${MY_BOOK}.epub`);
      const res = await post();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ linked: true, imported: false, alignment: { confidence: 1 } });
      expect(copies()).toEqual(before);
      expect(db.updates).toHaveLength(0);
    });

    it("fills in a missing alignment on the same book", async () => {
      db.seed("read_copies", { read_id: READ, user_id: ME, book_id: MY_BOOK, content_sha256: null, alignment: null });
      const res = await post({ bookId: MY_BOOK });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ alignment: { confidence: 1 } });
      expect(copies()).toHaveLength(1);
      expect(copies()[0].alignment).toMatchObject({ confidence: 1 });
      expect(copies()[0].content_sha256).toBe(createHash("sha256").update(FRANKENSTEIN).digest("hex"));
    });

    it("re-aligns the linked book when no bookId is sent and the alignment is null", async () => {
      db.seed("read_copies", { read_id: READ, user_id: ME, book_id: MY_BOOK, content_sha256: null, alignment: null });
      const res = await post();
      expect(await res.json()).toMatchObject({ linked: true, imported: false, alignment: { confidence: 1 } });
      expect(h.ingest).not.toHaveBeenCalled();
    });
  });

  it("uses the session user, not a body field", async () => {
    await post({ userId: OTHER, user_id: OTHER });
    expect(copies().every((c) => c.user_id === ME)).toBe(true);
  });
});
