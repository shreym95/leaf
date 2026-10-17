import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/groups/server/fake-admin.testkit";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CREATOR = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";
const GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_GROUP = "abababab-abab-4bab-8bab-abababababab";
const READ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_READ = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UNKNOWN_READ = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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

const remove = (ids: { groupId?: string; readId?: string } = {}) => {
  const groupId = ids.groupId ?? GROUP;
  const readId = ids.readId ?? READ;
  return DELETE(
    new Request(`http://localhost/api/groups/${groupId}/reads/${readId}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ groupId, readId }) },
  );
};

const readIds = () => db.rows("group_reads").map((r) => r.id);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.enabled = true;
  h.getUser.mockResolvedValue({ id: OWNER });
  db = new FakeDb();
  h.db = db;
  db.seed(
    "group_members",
    { group_id: GROUP, user_id: OWNER, role: "owner" },
    { group_id: GROUP, user_id: CREATOR, role: "member" },
    { group_id: GROUP, user_id: MEMBER, role: "member" },
    { group_id: OTHER_GROUP, user_id: STRANGER, role: "owner" },
  );
  db.seed(
    "group_reads",
    { id: READ, group_id: GROUP, created_by: CREATOR },
    { id: OTHER_READ, group_id: OTHER_GROUP, created_by: STRANGER },
  );
});

describe("DELETE /api/groups/:groupId/reads/:readId", () => {
  it("lets the owner remove a read someone else added", async () => {
    const res = await remove();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(readIds()).toEqual([OTHER_READ]);
  });

  it("lets the member who added the read remove it", async () => {
    h.getUser.mockResolvedValue({ id: CREATOR });
    const res = await remove();
    expect(res.status).toBe(204);
    expect(readIds()).toEqual([OTHER_READ]);
  });

  it("refuses a plain member who did not add the read", async () => {
    h.getUser.mockResolvedValue({ id: MEMBER });
    const res = await remove();
    expect(res.status).toBe(403);
    expect(readIds()).toEqual([READ, OTHER_READ]);
  });

  it("refuses a plain member when the creator account is gone", async () => {
    db.rows("group_reads")[0].created_by = null;
    h.getUser.mockResolvedValue({ id: MEMBER });
    const res = await remove();
    expect(res.status).toBe(403);
    expect(readIds()).toEqual([READ, OTHER_READ]);
  });

  it("answers 404 to someone outside the group and removes nothing", async () => {
    h.getUser.mockResolvedValue({ id: STRANGER });
    const res = await remove();
    expect(res.status).toBe(404);
    expect(readIds()).toEqual([READ, OTHER_READ]);
  });

  it("answers a non-member the same whether or not the read exists", async () => {
    h.getUser.mockResolvedValue({ id: STRANGER });
    const real = await remove();
    const missing = await remove({ readId: UNKNOWN_READ });
    expect(missing.status).toBe(real.status);
    expect(await missing.json()).toEqual(await real.json());
  });

  it("answers 404 for a read that belongs to a different group, even for the owner", async () => {
    const res = await remove({ readId: OTHER_READ });
    expect(res.status).toBe(404);
    expect(readIds()).toEqual([READ, OTHER_READ]);
  });

  it("answers 404 for an unknown read", async () => {
    const res = await remove({ readId: UNKNOWN_READ });
    expect(res.status).toBe(404);
    expect(readIds()).toEqual([READ, OTHER_READ]);
  });

  it("answers 404 for ids that are not UUIDs", async () => {
    expect((await remove({ readId: "nope" })).status).toBe(404);
    expect((await remove({ groupId: "nope" })).status).toBe(404);
    expect(readIds()).toEqual([READ, OTHER_READ]);
  });

  it("answers 401 when signed out", async () => {
    h.getUser.mockResolvedValue(null);
    const res = await remove();
    expect(res.status).toBe(401);
    expect(readIds()).toEqual([READ, OTHER_READ]);
  });

  it("answers 404 when groups are off, before any lookup", async () => {
    h.enabled = false;
    const res = await remove();
    expect(res.status).toBe(404);
    expect(h.getUser).not.toHaveBeenCalled();
    expect(readIds()).toEqual([READ, OTHER_READ]);
  });

  it("answers 500 when the delete fails", async () => {
    db.failOn = (table, op) =>
      table === "group_reads" && op === "delete"
        ? { code: "XX000", message: "boom" }
        : undefined;
    const res = await remove();
    expect(res.status).toBe(500);
    expect(readIds()).toEqual([READ, OTHER_READ]);
  });
});
