import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  flag: { enabled: true },
  getGroup: vi.fn(),
  listReads: vi.fn(),
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
  getGroup: (...args: unknown[]) => h.getGroup(...args),
  listReads: (...args: unknown[]) => h.listReads(...args),
}));

import GroupPage from "./page";

const GID = "11111111-1111-4111-8111-111111111111";
const params = (groupId: string) => ({ params: Promise.resolve({ groupId }) });

beforeEach(() => {
  h.flag.enabled = true;
  h.getGroup.mockReset();
  h.listReads.mockReset();
  h.listReads.mockResolvedValue([]);
});

describe("group page", () => {
  it("calls notFound when the flag is off, without touching data", async () => {
    h.flag.enabled = false;
    await expect(GroupPage(params(GID))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.getGroup).not.toHaveBeenCalled();
  });

  it("calls notFound for a malformed id", async () => {
    await expect(GroupPage(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.getGroup).not.toHaveBeenCalled();
  });

  it("calls notFound when the group is not visible", async () => {
    h.getGroup.mockResolvedValue(null);
    await expect(GroupPage(params(GID))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("calls notFound when the caller is not in the member list", async () => {
    h.getGroup.mockResolvedValue({
      group: { id: GID, name: "Club", created_at: "2026-01-01" },
      members: [],
    });
    await expect(GroupPage(params(GID))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the group for a member", async () => {
    h.getGroup.mockResolvedValue({
      group: { id: GID, name: "Club", created_at: "2026-01-01" },
      members: [
        { user_id: "u2", display_name: "Ben", role: "member", joined_at: "2026-01-02" },
        { user_id: "u1", display_name: "Ada", role: "owner", joined_at: "2026-01-01" },
      ],
    });
    h.listReads.mockResolvedValue([
      { id: "r1", title: "Middlemarch", author: "George Eliot" },
    ]);
    render(await GroupPage(params(GID)));
    expect(screen.getByRole("heading", { name: "Club" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Middlemarch" })).toHaveAttribute(
      "href",
      `/groups/${GID}/reads/r1`,
    );
  });
});
