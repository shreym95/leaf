import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/groups/server/fake-admin.testkit";

const OWNER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const OTHER = "44444444-4444-4444-8444-444444444444";
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

const del = (userId: string, groupId = GROUP) =>
  DELETE(
    new Request(`http://localhost/api/groups/${groupId}/members/${userId}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ groupId, userId }) },
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
    { group_id: GROUP, user_id: OTHER, role: "member" },
  );
  h.db = db;
});

describe("DELETE /api/groups/:groupId/members/:userId", () => {
  it("404s when groups are off", async () => {
    h.enabled = false;
    expect((await del(MEMBER)).status).toBe(404);
    expect(db.rows("group_members")).toHaveLength(3);
  });

  it("401s when signed out", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await del(MEMBER)).status).toBe(401);
  });

  it("403s for a non-member", async () => {
    h.getUser.mockResolvedValue({ id: STRANGER });
    expect((await del(MEMBER)).status).toBe(403);
    expect(db.rows("group_members")).toHaveLength(3);
  });

  it("403s for a member who is not the owner", async () => {
    h.getUser.mockResolvedValue({ id: MEMBER });
    expect((await del(OTHER)).status).toBe(403);
    expect(db.rows("group_members")).toHaveLength(3);
  });

  it("400s when the owner targets themselves", async () => {
    expect((await del(OWNER)).status).toBe(400);
    expect(db.rows("group_members")).toHaveLength(3);
  });

  it("404s for a user who is not in the group, or not a uuid", async () => {
    expect((await del(STRANGER)).status).toBe(404);
    expect((await del("nope")).status).toBe(404);
    expect(db.rows("group_members")).toHaveLength(3);
  });

  it("does not remove a member of a different group", async () => {
    db.seed("group_members", {
      group_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      user_id: STRANGER,
      role: "owner",
    });
    expect((await del(STRANGER)).status).toBe(404);
    expect(db.rows("group_members")).toHaveLength(4);
  });

  it("removes exactly the targeted member for the owner", async () => {
    const res = await del(MEMBER);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.rows("group_members").map((r) => r.user_id)).toEqual([OWNER, OTHER]);
  });
});
