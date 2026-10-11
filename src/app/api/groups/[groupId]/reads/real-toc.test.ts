// POST /api/groups/:groupId/reads with the real table-of-contents parser
// (route.test.ts mocks it) and real EPUB bytes.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/groups/server/fake-admin.testkit";

const ME = "11111111-1111-4111-8111-111111111111";
const FRIEND = "22222222-2222-4222-8222-222222222222";
const NO_BOOK = "44444444-4444-4444-8444-444444444444";
const GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MY_BOOK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FRIEND_BOOK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const h = vi.hoisted(() => ({
  enabled: true,
  getUser: vi.fn(),
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

import { POST } from "./route";

const FRANKENSTEIN = readFileSync("public/bundled/frankenstein.epub");
const TIME_MACHINE = readFileSync("public/bundled/time-machine.epub");

let db: FakeDb;

const post = (body: unknown) =>
  POST(
    new Request(`http://localhost/api/groups/${GROUP}/reads`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ groupId: GROUP }) },
  );

const body = {
  title: "Frankenstein",
  author: "Mary Shelley",
  source: "gutenberg",
  sourceRef: "84",
  bookId: MY_BOOK,
};

async function epubWithoutToc(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    "content.opf",
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="u"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata><manifest><item id="c1" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
  );
  zip.file("a.xhtml", "<html/>");
  return zip.generateAsync({ type: "uint8array" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.enabled = true;
  h.getUser.mockResolvedValue({ id: ME });
  db = new FakeDb();
  db.seed(
    "group_members",
    { group_id: GROUP, user_id: ME, role: "owner" },
    { group_id: GROUP, user_id: FRIEND, role: "member" },
    { group_id: GROUP, user_id: NO_BOOK, role: "member" },
  );
  const book = (id: string, user: string) => ({
    id,
    user_id: user,
    source: "gutenberg",
    source_ref: "84",
    storage_path: `${user}/${id}.epub`,
    archived_at: null,
    added_at: "2025-01-01",
  });
  db.seed("books", book(MY_BOOK, ME), book(FRIEND_BOOK, FRIEND));
  db.files.set(`${ME}/${MY_BOOK}.epub`, new Uint8Array(FRANKENSTEIN));
  db.files.set(`${FRIEND}/${FRIEND_BOOK}.epub`, new Uint8Array(TIME_MACHINE));
  h.db = db;
});

describe("POST /api/groups/:groupId/reads (real parser)", () => {
  it("builds the outline from a real EPUB and stores the caller's copy", async () => {
    const res = await post(body);
    expect(res.status).toBe(201);

    const [read] = db.rows("group_reads");
    const outline = read.outline as Array<{ label: string; depth: number; partLabel: string | null }>;
    expect(outline.length).toBeGreaterThan(30);
    expect(outline[0].label).toBe("Titlepage");
    expect(outline.some((e) => e.label === "Chapter XXIV" && e.partLabel === "Frankenstein")).toBe(true);

    const mine = db.rows("read_copies").find((c) => c.user_id === ME);
    expect(mine).toMatchObject({
      book_id: MY_BOOK,
      content_sha256: createHash("sha256").update(FRANKENSTEIN).digest("hex"),
    });
    expect(mine?.alignment).toMatchObject({ identity: true, confidence: 1 });
  });

  it("aligns a member's different copy of the same catalog book when linking it", async () => {
    const res = await post(body);
    expect(await res.json()).toMatchObject({ linked: 1, pending: 1 });

    const theirs = db.rows("read_copies").find((c) => c.user_id === FRIEND);
    expect(theirs).toMatchObject({
      book_id: FRIEND_BOOK,
      content_sha256: createHash("sha256").update(TIME_MACHINE).digest("hex"),
    });
    const alignment = theirs?.alignment as { confidence: number; copyHrefs: string[] };
    expect(alignment.confidence).toBeLessThan(0.5);
    expect(alignment.copyHrefs.length).toBe(18);
  });

  it("links a member whose EPUB cannot be read, with a null alignment", async () => {
    db.files.set(`${FRIEND}/${FRIEND_BOOK}.epub`, new Uint8Array([9, 9, 9]));
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ linked: 1 });
    expect(db.rows("read_copies").find((c) => c.user_id === FRIEND)).toMatchObject({
      book_id: FRIEND_BOOK,
      alignment: null,
    });
  });

  it("422s with a plain message when the book has no table of contents", async () => {
    db.files.set(`${ME}/${MY_BOOK}.epub`, await epubWithoutToc());
    const res = await post(body);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("This book has no table of contents.");
    expect(db.rows("group_reads")).toHaveLength(0);
    expect(db.rows("read_copies")).toHaveLength(0);
  });

  it("422s when the file is not a readable EPUB", async () => {
    db.files.set(`${ME}/${MY_BOOK}.epub`, new Uint8Array([1, 2, 3]));
    const res = await post(body);
    expect(res.status).toBe(422);
    expect(db.rows("group_reads")).toHaveLength(0);
  });
});
