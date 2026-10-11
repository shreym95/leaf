import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { FakeDb } from "@/lib/groups/server/fake-admin.testkit";

const ME = "11111111-1111-4111-8111-111111111111";
const FRIEND = "22222222-2222-4222-8222-222222222222";
const NO_BOOK = "44444444-4444-4444-8444-444444444444";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MY_BOOK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FRIEND_BOOK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FRIEND_ARCHIVED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STRANGER_BOOK = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const EPUB_BYTES = new Uint8Array([1, 2, 3, 4]);

const h = vi.hoisted(() => ({
  enabled: true,
  getUser: vi.fn(),
  extractToc: vi.fn(),
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
vi.mock("@/lib/groups/server/toc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups/server/toc")>()),
  extractEpubToc: h.extractToc,
}));

import { POST } from "./route";
import { InvalidEpubError } from "@/lib/epub/validate";

let db: FakeDb;

const TOC = [
  { href: "front.xhtml", label: "Preface" },
  {
    href: "part1.xhtml",
    label: "Part One",
    subitems: [
      { href: "c1.xhtml", label: "Chapter 1" },
      { href: "c2.xhtml", label: "Chapter 2" },
    ],
  },
];

const validBody = {
  title: "Frankenstein",
  author: "Mary Shelley",
  source: "upload",
  bookId: MY_BOOK,
};

const post = (body: unknown, groupId = GROUP) =>
  POST(
    new Request(`http://localhost/api/groups/${groupId}/reads`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ groupId }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.enabled = true;
  h.getUser.mockResolvedValue({ id: ME });
  h.extractToc.mockResolvedValue(TOC);
  db = new FakeDb();
  db.seed(
    "group_members",
    { group_id: GROUP, user_id: ME, role: "owner" },
    { group_id: GROUP, user_id: FRIEND, role: "member" },
    { group_id: GROUP, user_id: NO_BOOK, role: "member" },
  );
  db.seed(
    "books",
    {
      id: MY_BOOK,
      user_id: ME,
      source: "upload",
      source_ref: null,
      storage_path: `${ME}/${MY_BOOK}.epub`,
      archived_at: null,
    },
    {
      id: STRANGER_BOOK,
      user_id: STRANGER,
      source: "upload",
      source_ref: null,
      storage_path: `${STRANGER}/${STRANGER_BOOK}.epub`,
      archived_at: null,
    },
  );
  db.files.set(`${ME}/${MY_BOOK}.epub`, EPUB_BYTES);
  h.db = db;
});

describe("POST /api/groups/:groupId/reads", () => {
  it("404s when groups are off", async () => {
    h.enabled = false;
    expect((await post(validBody)).status).toBe(404);
    expect(db.rows("group_reads")).toHaveLength(0);
  });

  it("401s when signed out", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await post(validBody)).status).toBe(401);
  });

  it("403s for a non-member", async () => {
    h.getUser.mockResolvedValue({ id: STRANGER });
    const res = await post({ ...validBody, bookId: STRANGER_BOOK });
    expect(res.status).toBe(403);
    expect(db.rows("group_reads")).toHaveLength(0);
  });

  it.each([
    ["malformed json", "{nope"],
    ["no title", { ...validBody, title: "  " }],
    ["title too long", { ...validBody, title: "x".repeat(301) }],
    ["unknown source", { ...validBody, source: "kindle" }],
    ["catalog source without a reference", { ...validBody, source: "gutenberg" }],
    ["upload with a reference", { ...validBody, sourceRef: "84" }],
    ["bookId not a uuid", { ...validBody, bookId: "abc" }],
    ["no bookId", { ...validBody, bookId: undefined }],
  ])("400s on invalid input (%s)", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(db.rows("group_reads")).toHaveLength(0);
  });

  it("404s for a book that belongs to someone else", async () => {
    const res = await post({ ...validBody, bookId: STRANGER_BOOK });
    expect(res.status).toBe(404);
    expect(db.rows("group_reads")).toHaveLength(0);
    expect(h.extractToc).not.toHaveBeenCalled();
  });

  it("404s for a book that does not exist", async () => {
    const res = await post({
      ...validBody,
      bookId: "99999999-9999-4999-8999-999999999999",
    });
    expect(res.status).toBe(404);
  });

  it("422s when the book is not what the read claims", async () => {
    const res = await post({
      ...validBody,
      source: "gutenberg",
      sourceRef: "84",
    });
    expect(res.status).toBe(422);
    expect(db.rows("group_reads")).toHaveLength(0);
  });

  it("422s when the book's contents cannot be read", async () => {
    h.extractToc.mockRejectedValue(new InvalidEpubError("bad nav"));
    const res = await post(validBody);
    expect(res.status).toBe(422);
    expect(db.rows("group_reads")).toHaveLength(0);
  });

  it("422s when the book has no usable table of contents", async () => {
    h.extractToc.mockResolvedValue([]);
    const res = await post(validBody);
    expect(res.status).toBe(422);
    expect(db.rows("group_reads")).toHaveLength(0);
  });

  it("stores the outline without hrefs, and the caller's copy with an identity alignment", async () => {
    const res = await post(validBody);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.read.groupId).toBe(GROUP);
    expect(body).toMatchObject({ linked: 0, pending: 0 });

    const [read] = db.rows("group_reads");
    expect(read).toMatchObject({
      id: body.read.id,
      group_id: GROUP,
      title: "Frankenstein",
      author: "Mary Shelley",
      source: "upload",
      source_ref: null,
      schedule: null,
      created_by: ME,
    });
    expect(read.outline).toEqual([
      { index: 0, label: "Preface", depth: 0, partIndex: null, partLabel: null },
      { index: 1, label: "Chapter 1", depth: 1, partIndex: 0, partLabel: "Part One" },
      { index: 2, label: "Chapter 2", depth: 1, partIndex: 0, partLabel: "Part One" },
    ]);
    for (const entry of read.outline as Array<Record<string, unknown>>) {
      expect(entry).not.toHaveProperty("href");
    }

    const copies = db.rows("read_copies");
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({
      read_id: body.read.id,
      user_id: ME,
      book_id: MY_BOOK,
      content_sha256: createHash("sha256").update(EPUB_BYTES).digest("hex"),
    });
    expect(copies[0].alignment).toMatchObject({ identity: true, confidence: 1 });
  });

  it("uses the session user, not a body field, for creator and copy", async () => {
    await post({ ...validBody, userId: FRIEND, created_by: FRIEND });
    expect(db.rows("group_reads")[0].created_by).toBe(ME);
    expect(db.rows("read_copies")[0].user_id).toBe(ME);
  });

  it("does not link other members for an uploaded book", async () => {
    await post(validBody);
    expect(db.rows("read_copies")).toHaveLength(1);
  });

  it("for a catalog book links members who own it and counts the rest as pending", async () => {
    db.rows("books")[0].source = "gutenberg";
    db.rows("books")[0].source_ref = "84";
    db.seed(
      "books",
      // FRIEND owns it, archived and not: the live copy is linked.
      { id: FRIEND_ARCHIVED, user_id: FRIEND, source: "gutenberg", source_ref: "84", archived_at: "2026-01-01", added_at: "2025-01-01" },
      { id: FRIEND_BOOK, user_id: FRIEND, source: "gutenberg", source_ref: "84", archived_at: null, added_at: "2025-06-01" },
    );

    const res = await post({
      ...validBody,
      source: "gutenberg",
      sourceRef: "84",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ linked: 1, pending: 1 });

    const copies = db.rows("read_copies");
    expect(copies.map((c) => [c.user_id, c.book_id])).toEqual([
      [ME, MY_BOOK],
      [FRIEND, FRIEND_BOOK],
    ]);
    // Nobody else's book id is ever written for the creator, and vice versa.
    expect(copies.some((c) => c.user_id === NO_BOOK)).toBe(false);
  });

  it("removes the read again when the caller's copy cannot be linked", async () => {
    db.failOn = (table, op) =>
      table === "read_copies" && op === "upsert"
        ? { code: "XX000", message: "boom" }
        : undefined;
    const res = await post(validBody);
    expect(res.status).toBe(500);
    expect(db.rows("group_reads")).toHaveLength(0);
  });
});
