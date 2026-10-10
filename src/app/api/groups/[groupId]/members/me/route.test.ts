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

import { DELETE } from "./route";

let db: FakeDb;

const del = (groupId = GROUP) =>
  DELETE(
    new Request(`http://localhost/api/groups/${groupId}/members/me`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ groupId }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.enabled = true;
  h.getUser.mockResolvedValue({ id: MEMBER });
  db = new FakeDb();
  db.seed(
    "group_members",
    { group_id: GROUP, user_id: OWNER, role: "owner" },
    { group_id: GROUP, user_id: MEMBER, role: "member" },
  );
  h.db = db;
});

describe("DELETE /api/groups/:groupId/members/me", () => {
  it("404s when groups are off", async () => {
    h.enabled = false;
    expect((await del()).status).toBe(404);
    expect(db.rows("group_members")).toHaveLength(2);
  });

  it("401s when signed out", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await del()).status).toBe(401);
    expect(db.rows("group_members")).toHaveLength(2);
  });

  it("403s for a non-member", async () => {
    h.getUser.mockResolvedValue({ id: STRANGER });
    expect((await del()).status).toBe(403);
    expect(db.rows("group_members")).toHaveLength(2);
  });

  it("403s for an id that is not a uuid", async () => {
    expect((await del("nope")).status).toBe(403);
  });

  it("removes only the caller's membership", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.rows("group_members")).toEqual([
      { group_id: GROUP, user_id: OWNER, role: "owner" },
    ]);
  });

  it("lets the owner leave (the database hands ownership on)", async () => {
    h.getUser.mockResolvedValue({ id: OWNER });
    expect((await del()).status).toBe(200);
    expect(db.rows("group_members").map((r) => r.user_id)).toEqual([MEMBER]);
  });

  it("500s with a plain message when the delete fails", async () => {
    db.failOn = (table, op) =>
      table === "group_members" && op === "delete"
        ? { code: "XX000", message: "secret detail" }
        : undefined;
    const res = await del();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
