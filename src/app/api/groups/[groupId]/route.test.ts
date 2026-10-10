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

import { PATCH } from "./route";

let db: FakeDb;

const patch = (body: unknown, groupId = GROUP) =>
  PATCH(
    new Request(`http://localhost/api/groups/${groupId}`, {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ groupId }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.enabled = true;
  h.getUser.mockResolvedValue({ id: OWNER });
  db = new FakeDb();
  db.seed("groups", { id: GROUP, name: "Old" });
  db.seed(
    "group_members",
    { group_id: GROUP, user_id: OWNER, role: "owner" },
    { group_id: GROUP, user_id: MEMBER, role: "member" },
  );
  h.db = db;
});

describe("PATCH /api/groups/:groupId", () => {
  it("404s when groups are off", async () => {
    h.enabled = false;
    expect((await patch({ name: "New" })).status).toBe(404);
    expect(db.rows("groups")[0].name).toBe("Old");
  });

  it("401s when signed out", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await patch({ name: "New" })).status).toBe(401);
  });

  it("400s on a malformed body and on invalid names", async () => {
    expect((await patch("{nope")).status).toBe(400);
    expect((await patch({ name: "  " })).status).toBe(400);
    expect((await patch({ name: "x".repeat(61) })).status).toBe(400);
    expect(db.rows("groups")[0].name).toBe("Old");
  });

  it("403s for a non-member", async () => {
    h.getUser.mockResolvedValue({ id: STRANGER });
    expect((await patch({ name: "New" })).status).toBe(403);
    expect(db.rows("groups")[0].name).toBe("Old");
  });

  it("403s for a member who is not the owner", async () => {
    h.getUser.mockResolvedValue({ id: MEMBER });
    expect((await patch({ name: "New" })).status).toBe(403);
    expect(db.rows("groups")[0].name).toBe("Old");
  });

  it("403s for an id that is not a uuid", async () => {
    expect((await patch({ name: "New" }, "not-a-uuid")).status).toBe(403);
  });

  it("renames the group for the owner", async () => {
    const res = await patch({ name: " Fresh name " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ group: { id: GROUP, name: "Fresh name" } });
    expect(db.rows("groups")[0].name).toBe("Fresh name");
  });
});
