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

/** Ten chapters, so chapter indices 0..9 are valid. */
const OUTLINE = Array.from({ length: 10 }, (_, index) => ({
  index,
  label: `Chapter ${index + 1}`,
  depth: 0,
  partIndex: null,
  partLabel: null,
}));

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

const CHECKPOINTS = [
  { chapter_index: 2, due_on: "2026-11-06" },
  { chapter_index: 5, due_on: "2026-11-20" },
];

const patch = (
  body: unknown,
  ids: { groupId?: string; readId?: string } = {},
  raw?: string,
) => {
  const groupId = ids.groupId ?? GROUP;
  const readId = ids.readId ?? READ;
  return PATCH(
    new Request(`http://localhost/api/groups/${groupId}/reads/${readId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ groupId, readId }) },
  );
};

const storedSchedule = (id = READ) =>
  db.rows("group_reads").find((r) => r.id === id)?.schedule;

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
    { id: READ, group_id: GROUP, created_by: CREATOR, outline: OUTLINE, schedule: null },
    {
      id: OTHER_READ,
      group_id: OTHER_GROUP,
      created_by: STRANGER,
      outline: OUTLINE,
      schedule: null,
    },
  );
});

describe("PATCH /api/groups/:groupId/reads/:readId: who may set a schedule", () => {
  it("lets the owner set a schedule on a read someone else added", async () => {
    const res = await patch({ schedule: CHECKPOINTS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schedule: CHECKPOINTS });
    expect(storedSchedule()).toEqual(CHECKPOINTS);
  });

  it("lets the member who added the read set its schedule", async () => {
    h.getUser.mockResolvedValue({ id: CREATOR });
    const res = await patch({ schedule: CHECKPOINTS });
    expect(res.status).toBe(200);
    expect(storedSchedule()).toEqual(CHECKPOINTS);
  });

  it("refuses a plain member who did not add the read, and changes nothing", async () => {
    h.getUser.mockResolvedValue({ id: MEMBER });
    const res = await patch({ schedule: CHECKPOINTS });
    expect(res.status).toBe(403);
    expect(storedSchedule()).toBeNull();
    expect(db.updates).toEqual([]);
  });

  it("refuses a plain member when the creator account is gone", async () => {
    db.rows("group_reads")[0].created_by = null;
    h.getUser.mockResolvedValue({ id: MEMBER });
    const res = await patch({ schedule: CHECKPOINTS });
    expect(res.status).toBe(403);
    expect(storedSchedule()).toBeNull();
  });

  it("answers 404 to someone outside the group and changes nothing", async () => {
    h.getUser.mockResolvedValue({ id: STRANGER });
    const res = await patch({ schedule: CHECKPOINTS });
    expect(res.status).toBe(404);
    expect(db.updates).toEqual([]);
  });

  it("answers a non-member the same whether or not the read exists", async () => {
    h.getUser.mockResolvedValue({ id: STRANGER });
    const real = await patch({ schedule: CHECKPOINTS });
    const missing = await patch({ schedule: CHECKPOINTS }, { readId: UNKNOWN_READ });
    expect(missing.status).toBe(real.status);
    expect(await missing.json()).toEqual(await real.json());
  });

  it("answers 404 for a read in a different group, even for the owner of this group", async () => {
    const res = await patch({ schedule: CHECKPOINTS }, { readId: OTHER_READ });
    expect(res.status).toBe(404);
    expect(storedSchedule(OTHER_READ)).toBeNull();
    expect(db.updates).toEqual([]);
  });

  it("answers 404 for an unknown read", async () => {
    const res = await patch({ schedule: CHECKPOINTS }, { readId: UNKNOWN_READ });
    expect(res.status).toBe(404);
    expect(db.updates).toEqual([]);
  });

  it("answers 404 for ids that are not UUIDs", async () => {
    expect((await patch({ schedule: CHECKPOINTS }, { readId: "nope" })).status).toBe(404);
    expect((await patch({ schedule: CHECKPOINTS }, { groupId: "nope" })).status).toBe(404);
    expect(db.updates).toEqual([]);
  });

  it("answers 401 when signed out", async () => {
    h.getUser.mockResolvedValue(null);
    const res = await patch({ schedule: CHECKPOINTS });
    expect(res.status).toBe(401);
    expect(db.updates).toEqual([]);
  });

  it("answers 404 when groups are off, before any lookup", async () => {
    h.enabled = false;
    const res = await patch({ schedule: CHECKPOINTS });
    expect(res.status).toBe(404);
    expect(h.getUser).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });
});

describe("PATCH /api/groups/:groupId/reads/:readId: the schedule body", () => {
  it("answers 400 for a date that does not exist, and stores nothing", async () => {
    const res = await patch({
      schedule: [{ chapter_index: 2, due_on: "2026-02-30" }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringContaining("due_on") });
    expect(storedSchedule()).toBeNull();
  });

  it("answers 400 for a chapter index past the outline", async () => {
    const res = await patch({
      schedule: [{ chapter_index: OUTLINE.length, due_on: "2026-11-06" }],
    });
    expect(res.status).toBe(400);
    expect(storedSchedule()).toBeNull();
  });

  it("answers 400 for checkpoints out of chapter order", async () => {
    const res = await patch({
      schedule: [
        { chapter_index: 5, due_on: "2026-11-20" },
        { chapter_index: 2, due_on: "2026-11-21" },
      ],
    });
    expect(res.status).toBe(400);
    expect(storedSchedule()).toBeNull();
  });

  it("answers 400 for more than the allowed number of checkpoints", async () => {
    const res = await patch({
      schedule: Array.from({ length: 13 }, (_, i) => ({
        chapter_index: i % 10,
        due_on: "2026-11-06",
      })),
    });
    expect(res.status).toBe(400);
    expect(db.updates).toEqual([]);
  });

  it("answers 400 when the schedule key is missing", async () => {
    const res = await patch({ checkpoints: CHECKPOINTS });
    expect(res.status).toBe(400);
    expect(db.updates).toEqual([]);
  });

  it("answers 400 for a body that is not a JSON object", async () => {
    expect((await patch(null, {}, "not json")).status).toBe(400);
    expect((await patch(null, {}, "[1,2]")).status).toBe(400);
    expect((await patch(null, {}, '"schedule"')).status).toBe(400);
    expect(db.updates).toEqual([]);
  });

  it("answers 400 for a schedule that is neither a list nor null", async () => {
    const res = await patch({ schedule: "Friday" });
    expect(res.status).toBe(400);
    expect(db.updates).toEqual([]);
  });

  it("stores null and answers 200 for a null schedule (clears it)", async () => {
    db.rows("group_reads")[0].schedule = CHECKPOINTS;
    const res = await patch({ schedule: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schedule: null });
    expect(storedSchedule()).toBeNull();
  });

  it("stores null for an empty array (clears it)", async () => {
    db.rows("group_reads")[0].schedule = CHECKPOINTS;
    const res = await patch({ schedule: [] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schedule: null });
    expect(storedSchedule()).toBeNull();
  });

  it("writes only the two checkpoint keys", async () => {
    const res = await patch({
      schedule: [{ chapter_index: 1, due_on: "2026-11-06", note: "extra" }],
    });
    expect(res.status).toBe(200);
    expect(storedSchedule()).toEqual([{ chapter_index: 1, due_on: "2026-11-06" }]);
  });

  it("accepts a schedule on the last valid chapter of the outline", async () => {
    const res = await patch({
      schedule: [{ chapter_index: OUTLINE.length - 1, due_on: "2028-02-29" }],
    });
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/groups/:groupId/reads/:readId: failures", () => {
  it("answers 500 when the update fails", async () => {
    db.failOn = (table, op) =>
      table === "group_reads" && op === "update"
        ? { code: "XX000", message: "boom" }
        : undefined;
    const res = await patch({ schedule: CHECKPOINTS });
    expect(res.status).toBe(500);
    expect(storedSchedule()).toBeNull();
  });

  it("answers 500 when the lookup fails", async () => {
    db.failOn = (table, op) =>
      table === "group_reads" && op === "select"
        ? { code: "XX000", message: "boom" }
        : undefined;
    const res = await patch({ schedule: CHECKPOINTS });
    expect(res.status).toBe(500);
  });
});
