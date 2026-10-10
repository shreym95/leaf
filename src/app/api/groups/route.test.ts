import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/groups/server/fake-admin.testkit";

const USER = "11111111-1111-4111-8111-111111111111";

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

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/groups", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.enabled = true;
  h.getUser.mockResolvedValue({ id: USER });
  db = new FakeDb();
  h.db = db;
});

describe("POST /api/groups", () => {
  it("404s when groups are off and touches nothing", async () => {
    h.enabled = false;
    const res = await post({ name: "Club" });
    expect(res.status).toBe(404);
    expect(h.getUser).not.toHaveBeenCalled();
    expect(db.rows("groups")).toHaveLength(0);
  });

  it("401s when signed out", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await post({ name: "Club" })).status).toBe(401);
    expect(db.rows("groups")).toHaveLength(0);
  });

  it("400s on a malformed body", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect((await post("[]")).status).toBe(400);
  });

  it.each([
    ["missing", undefined],
    ["not a string", 7],
    ["empty", ""],
    ["blank", "   "],
    ["61 characters", "x".repeat(61)],
  ])("400s on an invalid name (%s)", async (_label, name) => {
    const res = await post({ name });
    expect(res.status).toBe(400);
    expect(db.rows("groups")).toHaveLength(0);
  });

  it("accepts 60 characters, counted as characters not bytes", async () => {
    const res = await post({ name: "é".repeat(60) });
    expect(res.status).toBe(201);
  });

  it("creates the group and the caller's owner membership", async () => {
    const res = await post({ name: "  Night readers  ", userId: "someone-else" });
    expect(res.status).toBe(201);
    const { group } = await res.json();
    expect(group.name).toBe("Night readers");
    expect(db.rows("groups")).toHaveLength(1);
    expect(db.rows("group_members")).toEqual([
      { group_id: group.id, user_id: USER, role: "owner" },
    ]);
  });

  it("deletes the group when the membership insert fails", async () => {
    db.insertHook = (table) =>
      table === "group_members" ? { code: "XX000", message: "boom" } : undefined;
    const res = await post({ name: "Club" });
    expect(res.status).toBe(500);
    expect(db.rows("groups")).toHaveLength(0);
    expect(db.rows("group_members")).toHaveLength(0);
  });

  it("500s with a plain message when the group insert fails", async () => {
    db.failOn = (table, op) =>
      table === "groups" && op === "insert"
        ? { code: "XX000", message: "secret detail" }
        : undefined;
    const res = await post({ name: "Club" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
