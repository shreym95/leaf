// Accepting an invite aligns the member's copy of each catalog read.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/groups/server/fake-admin.testkit";
import { buildOutline } from "@/lib/groups/outline";
import { toStoredOutline } from "@/lib/groups/server/reads";
import { extractEpubToc } from "@/lib/groups/server/toc";

const OWNER = "11111111-1111-4111-8111-111111111111";
const JOINER = "22222222-2222-4222-8222-222222222222";
const GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "T".repeat(43);

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  ingest: vi.fn(),
  fetchPg: vi.fn(),
  db: null as unknown as { client(): unknown },
}));

vi.mock("@/lib/groups/flag", () => ({ GROUPS_ENABLED: true }));
vi.mock("@/lib/auth", () => ({ getUser: h.getUser }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => h.db.client(),
}));
vi.mock("@/lib/books/ingest", () => ({ ingestEpub: h.ingest }));
vi.mock("@/lib/import/standard-ebooks", () => ({ fetchStandardEbooksEpub: vi.fn() }));
vi.mock("@/lib/import/gutendex", () => ({ fetchGutenbergEpub: h.fetchPg }));

import { POST } from "./route";

const FRANKENSTEIN = readFileSync("public/bundled/frankenstein.epub");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let db: FakeDb;

const accept = () =>
  POST(new Request(`http://localhost/api/invites/${TOKEN}/accept`, { method: "POST" }), {
    params: Promise.resolve({ token: TOKEN }),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.getUser.mockResolvedValue({ id: JOINER });
  h.fetchPg.mockResolvedValue(new ArrayBuffer(8));
  h.ingest.mockImplementation(async (p: { userId: string; sourceRef: string }) => {
    const id = `imported-${p.sourceRef}`;
    db.seed("books", {
      id,
      user_id: p.userId,
      source: "gutenberg",
      source_ref: p.sourceRef,
      storage_path: `${p.userId}/${id}.epub`,
      archived_at: null,
    });
    db.files.set(`${p.userId}/${id}.epub`, new Uint8Array(FRANKENSTEIN));
    return { id };
  });
  db = new FakeDb();
  db.seed("group_members", { group_id: GROUP, user_id: OWNER, role: "owner" });
  db.seed("group_invites", {
    token: TOKEN,
    group_id: GROUP,
    created_by: OWNER,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    max_uses: 4,
    uses: 0,
  });
  db.seed("group_reads", {
    id: "read-pg",
    group_id: GROUP,
    title: "Frankenstein",
    source: "gutenberg",
    source_ref: "84",
    outline: toStoredOutline(buildOutline(await extractEpubToc(FRANKENSTEIN))),
  });
  h.db = db;
});

describe("POST /api/invites/:token/accept: alignment", () => {
  it("aligns an imported copy", async () => {
    const res = await accept();
    expect(await res.json()).toMatchObject({ imported: 1, failed: [] });
    const [copy] = db.rows("read_copies");
    expect(copy).toMatchObject({ user_id: JOINER, book_id: "imported-84", content_sha256: sha(FRANKENSTEIN) });
    expect(copy.alignment).toMatchObject({ confidence: 1 });
  });

  it("aligns an existing copy that is linked", async () => {
    db.seed("books", {
      id: "own",
      user_id: JOINER,
      source: "gutenberg",
      source_ref: "84",
      storage_path: `${JOINER}/own.epub`,
      archived_at: null,
      added_at: "2025-01-01",
    });
    db.files.set(`${JOINER}/own.epub`, new Uint8Array(FRANKENSTEIN));
    const res = await accept();
    expect(await res.json()).toMatchObject({ linked: 1, imported: 0 });
    expect(db.rows("read_copies")[0]).toMatchObject({ book_id: "own", content_sha256: sha(FRANKENSTEIN) });
    expect(db.rows("read_copies")[0].alignment).toMatchObject({ confidence: 1 });
  });

  it("still links with a null alignment when the copy cannot be read", async () => {
    h.ingest.mockImplementation(async (p: { userId: string; sourceRef: string }) => {
      const id = `imported-${p.sourceRef}`;
      db.seed("books", { id, user_id: p.userId, storage_path: `${p.userId}/${id}.epub`, archived_at: null });
      db.files.set(`${p.userId}/${id}.epub`, new Uint8Array([1, 2, 3]));
      return { id };
    });
    const res = await accept();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 1, failed: [] });
    expect(db.rows("read_copies")[0]).toMatchObject({ book_id: "imported-84", alignment: null });
  });
});
