import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  flag: { enabled: true },
  listMyGroups: vi.fn(),
}));

vi.mock("@/lib/groups/flag", () => ({
  get GROUPS_ENABLED() {
    return h.flag.enabled;
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/db/groups", () => ({
  listMyGroups: (...args: unknown[]) => h.listMyGroups(...args),
}));

import GroupsPage from "./page";

beforeEach(() => {
  h.flag.enabled = true;
  h.listMyGroups.mockReset();
});

describe("groups page", () => {
  it("calls notFound when the flag is off, without touching data", async () => {
    h.flag.enabled = false;
    await expect(GroupsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.listMyGroups).not.toHaveBeenCalled();
  });

  it("renders the user's groups when the flag is on", async () => {
    h.listMyGroups.mockResolvedValue([
      {
        group: { id: "g1", name: "Tuesday club", created_at: "2026-01-01" },
        role: "owner",
        memberCount: 2,
      },
    ]);
    render(await GroupsPage());
    expect(screen.getByRole("link", { name: /tuesday club/i })).toHaveAttribute(
      "href",
      "/groups/g1",
    );
    expect(h.listMyGroups).toHaveBeenCalledWith("u1", expect.anything());
  });
});
