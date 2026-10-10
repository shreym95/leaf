import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/groups/server/fake-admin.testkit";

const OWNER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

let db: FakeDb;

const post = (groupId = GROUP) =>
  POST(
    new Request(`http://localhost/api/groups/${groupId}/invites`, {
      method: "POST",
    }),
    { params: Promise.resolve({ groupId }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.enabled = true;
  h.getUser.mockResolvedValue({ id: OWNER });
  db = new FakeDb();
  db.seed(
    "group_members",
    { group_id: GROUP, user_id: OWNER, role: "owner" },
    { group_id: GROUP, user_id: MEMBER, role: "member" },
  );
  h.db = db;
});

describe("POST /api/groups/:groupId/invites", () => {
  it("404s when groups are off", async () => {
    h.enabled = false;
    expect((await post()).status).toBe(404);
    expect(db.rows("group_invites")).toHaveLength(0);
  });

  it("401s when signed out", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
  });

  it("403s for a non-member", async () => {
    h.getUser.mockResolvedValue({ id: STRANGER });
    expect((await post()).status).toBe(403);
    expect(db.rows("group_invites")).toHaveLength(0);
  });

  it("403s for a member who is not the owner", async () => {
    h.getUser.mockResolvedValue({ id: MEMBER });
    expect((await post()).status).toBe(403);
    expect(db.rows("group_invites")).toHaveLength(0);
  });

  it("creates a 7 day, 4 use invite with a url-safe token of at least 43 characters", async () => {
    const before = Date.now();
    const res = await post();
    expect(res.status).toBe(201);
    const body = await res.json();

    const [row] = db.rows("group_invites");
    expect(body.url).toBe(`/invite/${row.token}`);
    expect(row.token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(row).toMatchObject({
      group_id: GROUP,
      created_by: OWNER,
      max_uses: 4,
    });
    expect(row.uses ?? 0).toBe(0);

    const expiresAt = new Date(body.expiresAt).getTime();
    expect(body.expiresAt).toBe(row.expires_at);
    expect(expiresAt - before).toBeGreaterThanOrEqual(7 * 24 * 3600 * 1000 - 1000);
    expect(expiresAt - before).toBeLessThanOrEqual(7 * 24 * 3600 * 1000 + 5000);
  });

  it("mints a different token every call", async () => {
    await post();
    await post();
    const [a, b] = db.rows("group_invites");
    expect(a.token).not.toBe(b.token);
  });

  it("500s with a plain message when the insert fails", async () => {
    db.failOn = (table, op) =>
      table === "group_invites" && op === "insert"
        ? { code: "XX000", message: "secret detail" }
        : undefined;
    const res = await post();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
