import { describe, it, expect, vi, beforeEach } from "vitest";

/* Hoisted mock state so the module factories can read it. */
const h = vi.hoisted(() => ({
  configured: true,
  getUser: vi.fn(),
  createClientThrows: false,
}));

vi.mock("./supabase/server", () => ({
  get isSupabaseConfigured() {
    return h.configured;
  },
  createClient: vi.fn(async () => {
    if (h.createClientThrows) throw new Error("not configured");
    return { auth: { getUser: h.getUser } };
  }),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

import { getUser, requireUser } from "./auth";

const fakeUser = { id: "u1", email: "reader@example.com" };

beforeEach(() => {
  h.configured = true;
  h.createClientThrows = false;
  h.getUser.mockReset();
  redirect.mockClear();
});

describe("getUser", () => {
  it("returns null when Supabase env is not configured (SSR still works)", async () => {
    h.configured = false;
    expect(await getUser()).toBeNull();
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("returns the user when signed in", async () => {
    h.getUser.mockResolvedValue({ data: { user: fakeUser } });
    expect(await getUser()).toEqual(fakeUser);
  });

  it("returns null when signed out", async () => {
    h.getUser.mockResolvedValue({ data: { user: null } });
    expect(await getUser()).toBeNull();
  });

  it("swallows client errors and returns null", async () => {
    h.createClientThrows = true;
    expect(await getUser()).toBeNull();
  });
});

describe("requireUser", () => {
  it("returns the user when signed in", async () => {
    h.getUser.mockResolvedValue({ data: { user: fakeUser } });
    expect(await requireUser()).toEqual(fakeUser);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /login when signed out", async () => {
    h.getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("preserves the intended destination in ?next=", async () => {
    h.getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireUser("/reader/abc?page=2")).rejects.toThrow(
      "REDIRECT:/login?next=%2Freader%2Fabc%3Fpage%3D2",
    );
  });
});
