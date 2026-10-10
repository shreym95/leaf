import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "@/lib/groups/server/fake-admin.testkit";

const OWNER = "11111111-1111-4111-8111-111111111111";
const JOINER = "22222222-2222-4222-8222-222222222222";
const GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "T".repeat(43);

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

let db: FakeDb;

const accept = (token = TOKEN) =>
  POST(
    new Request(`http://localhost/api/invites/${token}/accept`, {
      method: "POST",
    }),
    { params: Promise.resolve({ token }) },
  );

const inFuture = () => new Date(Date.now() + 3600_000).toISOString();
const inPast = () => new Date(Date.now() - 3600_000).toISOString();

function invite(): Row {
  return db.rows("group_invites")[0];
}
function memberIds(): unknown[] {
  return db.rows("group_members").map((r) => r.user_id);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.enabled = true;
  h.getUser.mockResolvedValue({ id: JOINER });
  h.fetchSe.mockResolvedValue(new ArrayBuffer(8));
  h.fetchPg.mockResolvedValue(new ArrayBuffer(8));
  h.ingest.mockImplementation(async (p: { sourceRef: string }) => ({
    id: `imported-${p.sourceRef}`,
  }));
  db = new FakeDb();
  db.seed("group_members", { group_id: GROUP, user_id: OWNER, role: "owner" });
  db.seed("group_invites", {
    token: TOKEN,
    group_id: GROUP,
    created_by: OWNER,
    expires_at: inFuture(),
    max_uses: 4,
    uses: 0,
  });
  h.db = db;
});

describe("POST /api/invites/:token/accept", () => {
  describe("rejections", () => {
    it("404s when groups are off", async () => {
      h.enabled = false;
      expect((await accept()).status).toBe(404);
      expect(memberIds()).toEqual([OWNER]);
      expect(invite().uses).toBe(0);
    });

    it("401s when signed out", async () => {
      h.getUser.mockResolvedValue(null);
      expect((await accept()).status).toBe(401);
      expect(memberIds()).toEqual([OWNER]);
    });

    it("404s on a token that is too short or has odd characters", async () => {
      expect((await accept("short")).status).toBe(404);
      expect((await accept("a/b".padEnd(43, "x"))).status).toBe(404);
      expect(memberIds()).toEqual([OWNER]);
    });

    it("404s on an unknown token", async () => {
      expect((await accept("U".repeat(43))).status).toBe(404);
      expect(memberIds()).toEqual([OWNER]);
    });

    it("410s on an expired invite and does not spend a use", async () => {
      invite().expires_at = inPast();
      const res = await accept();
      expect(res.status).toBe(410);
      expect(memberIds()).toEqual([OWNER]);
      expect(invite().uses).toBe(0);
    });

    it("410s on a used-up invite", async () => {
      invite().uses = 4;
      const res = await accept();
      expect(res.status).toBe(410);
      expect(memberIds()).toEqual([OWNER]);
      expect(invite().uses).toBe(4);
    });

    it("409s when the group is full and gives the use back", async () => {
      db.insertHook = (table) =>
        table === "group_members"
          ? { code: "23514", message: "group is full (max 5 members)" }
          : undefined;
      const res = await accept();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "This group is full." });
      expect(memberIds()).toEqual([OWNER]);
      expect(invite().uses).toBe(0);
    });

    it("500s with a plain message on any other membership error, and gives the use back", async () => {
      db.insertHook = (table) =>
        table === "group_members"
          ? { code: "XX000", message: "secret detail" }
          : undefined;
      const res = await accept();
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toContain("secret detail");
      expect(invite().uses).toBe(0);
    });
  });

  describe("joining", () => {
    it("adds the session user as a member and spends one use", async () => {
      const res = await accept();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        groupId: GROUP,
        alreadyMember: false,
        linked: 0,
        imported: 0,
        failed: [],
      });
      expect(db.rows("group_members")).toContainEqual({
        group_id: GROUP,
        user_id: JOINER,
        role: "member",
      });
      expect(invite().uses).toBe(1);
    });

    it("is idempotent for an existing member: 200, no use spent", async () => {
      db.seed("group_members", { group_id: GROUP, user_id: JOINER, role: "member" });
      const res = await accept();
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ groupId: GROUP, alreadyMember: true });
      expect(invite().uses).toBe(0);
      expect(db.rows("group_members")).toHaveLength(2);
    });

    it("lets an existing member through even when the invite has expired or is used up", async () => {
      db.seed("group_members", { group_id: GROUP, user_id: JOINER, role: "member" });
      invite().expires_at = inPast();
      invite().uses = 4;
      const res = await accept();
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ alreadyMember: true });
    });

    it("treats a parallel duplicate insert as already a member and gives the use back", async () => {
      db.insertHook = (table) =>
        table === "group_members"
          ? { code: "23505", message: "duplicate key" }
          : undefined;
      const res = await accept();
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ alreadyMember: true });
      expect(invite().uses).toBe(0);
    });
  });

  describe("race guard on the last use", () => {
    it("loses cleanly when another accept takes the last use first", async () => {
      invite().uses = 3;
      db.beforeUpdate = (table) => {
        // Another request lands between our read and our conditional update.
        if (table === "group_invites" && invite().uses === 3) invite().uses = 4;
      };
      const res = await accept();
      expect(res.status).toBe(410);
      expect(memberIds()).toEqual([OWNER]);
      expect(invite().uses).toBe(4);
    });

    it("retries and still joins when the other accept left a use over", async () => {
      invite().uses = 1;
      let raced = false;
      db.beforeUpdate = (table) => {
        if (table === "group_invites" && !raced) {
          raced = true;
          invite().uses = 2;
        }
      };
      const res = await accept();
      expect(res.status).toBe(200);
      expect(memberIds()).toContain(JOINER);
      // 1 -> 2 by the racer, 2 -> 3 by us: no use lost, none double counted.
      expect(invite().uses).toBe(3);
    });

    it("never spends a use past max_uses", async () => {
      invite().max_uses = 1;
      const first = await accept();
      expect(first.status).toBe(200);
      h.getUser.mockResolvedValue({ id: "55555555-5555-4555-8555-555555555555" });
      const second = await accept();
      expect(second.status).toBe(410);
      expect(invite().uses).toBe(1);
      expect(db.rows("group_members")).toHaveLength(2);
    });
  });

  describe("catalog reads: link or import", () => {
    function seedRead(id: string, source: string, ref: string | null, title = id) {
      db.seed("group_reads", {
        id,
        group_id: GROUP,
        title,
        source,
        source_ref: ref,
      });
    }

    it("links the member's existing non-archived book instead of importing a duplicate", async () => {
      seedRead("read-se", "standardebooks", "mary-shelley/frankenstein");
      db.seed("books", {
        id: "own-book",
        user_id: JOINER,
        source: "standardebooks",
        source_ref: "mary-shelley/frankenstein",
        archived_at: null,
        added_at: "2025-01-01",
      });

      const res = await accept();
      expect(await res.json()).toMatchObject({ linked: 1, imported: 0, failed: [] });
      expect(h.ingest).not.toHaveBeenCalled();
      expect(h.fetchSe).not.toHaveBeenCalled();
      expect(db.rows("read_copies")).toEqual([
        {
          read_id: "read-se",
          user_id: JOINER,
          book_id: "own-book",
          content_sha256: null,
          alignment: null,
        },
      ]);
    });

    it("imports through the ingest path as the caller when the member has no copy", async () => {
      seedRead("read-pg", "gutenberg", "84");

      const res = await accept();
      expect(await res.json()).toMatchObject({ linked: 0, imported: 1, failed: [] });
      expect(h.fetchPg).toHaveBeenCalledWith("84");
      expect(h.ingest).toHaveBeenCalledTimes(1);
      expect(h.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: JOINER,
          source: "gutenberg",
          sourceRef: "84",
        }),
      );
      expect(db.rows("read_copies")).toMatchObject([
        { read_id: "read-pg", user_id: JOINER, book_id: "imported-84" },
      ]);
    });

    it("imports when the member's only copy is archived, or someone else's", async () => {
      seedRead("read-se", "standardebooks", "a/b");
      db.seed(
        "books",
        { id: "archived", user_id: JOINER, source: "standardebooks", source_ref: "a/b", archived_at: "2026-01-01", added_at: "2025-01-01" },
        { id: "theirs", user_id: OWNER, source: "standardebooks", source_ref: "a/b", archived_at: null, added_at: "2025-01-01" },
      );
      const res = await accept();
      expect(await res.json()).toMatchObject({ linked: 0, imported: 1 });
      expect(db.rows("read_copies")[0].book_id).toBe("imported-a/b");
    });

    it("does not match a book with the same ref from a different source", async () => {
      seedRead("read-pg", "gutenberg", "84");
      db.seed("books", {
        id: "se-84",
        user_id: JOINER,
        source: "standardebooks",
        source_ref: "84",
        archived_at: null,
        added_at: "2025-01-01",
      });
      const res = await accept();
      expect(await res.json()).toMatchObject({ linked: 0, imported: 1 });
    });

    it("leaves uploaded reads alone", async () => {
      seedRead("read-up", "upload", null);
      const res = await accept();
      expect(await res.json()).toMatchObject({ linked: 0, imported: 0, failed: [] });
      expect(h.ingest).not.toHaveBeenCalled();
      expect(db.rows("read_copies")).toHaveLength(0);
    });

    it("still joins when an import fails, and reports it", async () => {
      seedRead("read-pg", "gutenberg", "84", "Frankenstein");
      seedRead("read-se", "standardebooks", "a/b", "Other");
      h.fetchPg.mockRejectedValue(new Error("network down"));

      const res = await accept();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        groupId: GROUP,
        alreadyMember: false,
        linked: 0,
        imported: 1,
        failed: [{ readId: "read-pg", title: "Frankenstein" }],
      });
      expect(memberIds()).toContain(JOINER);
      expect(db.rows("read_copies").map((c) => c.read_id)).toEqual(["read-se"]);
    });
  });
});
