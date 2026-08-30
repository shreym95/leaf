import { describe, it, expect, vi, beforeEach } from "vitest";

// This suite covers the ROUTE's HTTP contract and the deletion ORDER
// (SPEC §9 M4). Auth and the service-role admin client are mocked — the real
// admin client is server-only and never loaded here.

const USER_ID = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    getUser: vi.fn(),
    signOut: vi.fn(),
    // admin.storage.from("epubs")
    storageList: vi.fn(),
    storageRemove: vi.fn(),
    // admin.from(table).delete().eq()
    rowDeleteEq: vi.fn(),
    tableNames: [] as string[],
    // admin.auth.admin.deleteUser()
    deleteUser: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ getUser: h.getUser }));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseConfigured: true,
  createClient: vi.fn(async () => ({
    auth: { signOut: h.signOut },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: () => ({
        list: h.storageList,
        remove: h.storageRemove,
      }),
    },
    from: (table: string) => ({
      delete: () => ({
        eq: (col: string, val: string) => h.rowDeleteEq(table, col, val),
      }),
    }),
    auth: { admin: { deleteUser: h.deleteUser } },
  })),
}));

import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://localhost:3000/api/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  h.order.length = 0;
  h.tableNames.length = 0;

  h.getUser.mockReset().mockResolvedValue({
    id: USER_ID,
    email: "reader@example.com",
  });
  h.signOut.mockReset().mockResolvedValue({ error: null });

  h.storageList
    .mockReset()
    .mockImplementation(async () => {
      h.order.push("storage.list");
      // One flat page below the page size -> the pagination loop exits after it.
      return {
        data: [{ id: "obj-1", name: "book-1.epub" }],
        error: null,
      };
    });
  h.storageRemove.mockReset().mockImplementation(async (paths: string[]) => {
    h.order.push(`storage.remove(${paths.join(",")})`);
    return { data: paths, error: null };
  });

  h.rowDeleteEq
    .mockReset()
    .mockImplementation(async (table: string, col: string, val: string) => {
      h.order.push(`row.delete(${table} where ${col}=${val})`);
      h.tableNames.push(table);
      return { error: null };
    });

  h.deleteUser.mockReset().mockImplementation(async (id: string) => {
    h.order.push(`auth.deleteUser(${id})`);
    return { data: { user: null }, error: null };
  });
});

describe("POST /api/account/delete", () => {
  it("401s when not signed in", async () => {
    h.getUser.mockResolvedValue(null);
    const res = await POST(req({ confirm: "DELETE" }));
    expect(res.status).toBe(401);
    expect(h.storageList).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("400s without the exact confirmation word", async () => {
    const res = await POST(req({ confirm: "delete" }));
    expect(res.status).toBe(400);
    expect(h.storageList).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("400s on a malformed body", async () => {
    const res = await POST(req("{not json"));
    expect(res.status).toBe(400);
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("happy path: storage remove -> row deletes -> deleteUser, in that order, for the session user", async () => {
    const res = await POST(req({ confirm: "DELETE" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Storage cleanup happens first, then rows, then the auth user.
    expect(h.order).toEqual([
      "storage.list",
      `storage.remove(${USER_ID}/book-1.epub)`,
      `row.delete(highlights where user_id=${USER_ID})`,
      `row.delete(reading_state where user_id=${USER_ID})`,
      `row.delete(books where user_id=${USER_ID})`,
      `row.delete(reader_settings where user_id=${USER_ID})`,
      `row.delete(profiles where id=${USER_ID})`,
      `auth.deleteUser(${USER_ID})`,
    ]);

    // Children before parents, and the auth user is removed exactly once.
    expect(h.tableNames).toEqual([
      "highlights",
      "reading_state",
      "books",
      "reader_settings",
      "profiles",
    ]);
    expect(h.deleteUser).toHaveBeenCalledTimes(1);
    expect(h.deleteUser).toHaveBeenCalledWith(USER_ID);
    // Session is cleared afterwards.
    expect(h.signOut).toHaveBeenCalled();
  });

  it("removes nothing from Storage when the prefix is empty, but still deletes rows + user", async () => {
    h.storageList.mockImplementation(async () => {
      h.order.push("storage.list");
      return { data: [], error: null };
    });
    const res = await POST(req({ confirm: "DELETE" }));
    expect(res.status).toBe(200);
    expect(h.storageRemove).not.toHaveBeenCalled();
    expect(h.deleteUser).toHaveBeenCalledWith(USER_ID);
  });

  it("a Storage failure surfaces as 500 and does NOT delete rows or the auth user", async () => {
    h.storageRemove.mockResolvedValue({
      data: null,
      error: { message: "storage down" },
    });
    const res = await POST(req({ confirm: "DELETE" }));
    expect(res.status).toBe(500);
    expect(h.rowDeleteEq).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("a Storage list failure surfaces as 500 and does NOT delete the auth user", async () => {
    h.storageList.mockResolvedValue({
      data: null,
      error: { message: "list failed" },
    });
    const res = await POST(req({ confirm: "DELETE" }));
    expect(res.status).toBe(500);
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("a row-delete failure surfaces as 500 and does NOT delete the auth user", async () => {
    h.rowDeleteEq.mockImplementation(async (table: string) => {
      if (table === "books") return { error: { message: "fk violation" } };
      return { error: null };
    });
    const res = await POST(req({ confirm: "DELETE" }));
    expect(res.status).toBe(500);
    expect(h.deleteUser).not.toHaveBeenCalled();
  });
});
