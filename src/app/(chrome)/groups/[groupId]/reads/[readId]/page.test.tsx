import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  flag: { enabled: true },
  getGroup: vi.fn(),
  listReads: vi.fn(),
  getReadProgress: vi.fn(),
  listMilestones: vi.fn(),
  getMyCopy: vi.fn(),
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
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/db/groups", () => ({
  getGroup: (...a: unknown[]) => h.getGroup(...a),
  listReads: (...a: unknown[]) => h.listReads(...a),
  getReadProgress: (...a: unknown[]) => h.getReadProgress(...a),
  listMilestones: (...a: unknown[]) => h.listMilestones(...a),
  getMyCopy: (...a: unknown[]) => h.getMyCopy(...a),
  setManualProgress: vi.fn(),
}));

import ReadPage from "./page";

const GID = "11111111-1111-4111-8111-111111111111";
const RID = "22222222-2222-4222-8222-222222222222";
const params = (groupId: string, readId: string) => ({
  params: Promise.resolve({ groupId, readId }),
});

const detail = {
  group: { id: GID, name: "Club", created_at: "2026-01-01" },
  members: [
    { user_id: "u1", display_name: "Ada", role: "owner", joined_at: "2026-01-01" },
    { user_id: "u2", display_name: "Ben", role: "member", joined_at: "2026-01-02" },
  ],
};
const read = {
  id: RID,
  group_id: GID,
  title: "Middlemarch",
  author: "George Eliot",
  source: "standardebooks",
  outline: [
    { index: 0, label: "Book I", depth: 0, partIndex: null, partLabel: null, href: "a" },
    { index: 1, label: "Book II", depth: 0, partIndex: null, partLabel: null, href: "b" },
  ],
};

beforeEach(() => {
  h.flag.enabled = true;
  for (const fn of [h.getGroup, h.listReads, h.getReadProgress, h.listMilestones, h.getMyCopy]) {
    fn.mockReset();
  }
  h.getGroup.mockResolvedValue(detail);
  h.listReads.mockResolvedValue([read]);
  h.getReadProgress.mockResolvedValue([]);
  h.listMilestones.mockResolvedValue([]);
  h.getMyCopy.mockResolvedValue(null);
});

describe("group read page", () => {
  it("calls notFound when the flag is off, without touching data", async () => {
    h.flag.enabled = false;
    await expect(ReadPage(params(GID, RID))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.getGroup).not.toHaveBeenCalled();
  });

  it("calls notFound for a malformed id", async () => {
    await expect(ReadPage(params(GID, "nope"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(ReadPage(params("nope", RID))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.getGroup).not.toHaveBeenCalled();
  });

  it("calls notFound when the group is not visible", async () => {
    h.getGroup.mockResolvedValue(null);
    await expect(ReadPage(params(GID, RID))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("calls notFound for a non-member, before reading progress", async () => {
    h.getGroup.mockResolvedValue({ ...detail, members: [detail.members[1]] });
    await expect(ReadPage(params(GID, RID))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.getReadProgress).not.toHaveBeenCalled();
  });

  it("calls notFound for an unknown read", async () => {
    h.listReads.mockResolvedValue([{ ...read, id: "33333333-3333-4333-8333-333333333333" }]);
    await expect(ReadPage(params(GID, RID))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.getReadProgress).not.toHaveBeenCalled();
  });

  it("renders the read for a member without a copy", async () => {
    render(await ReadPage(params(GID, RID)));
    expect(screen.getByRole("heading", { name: "Middlemarch" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Club/ })).toHaveAttribute("href", `/groups/${GID}`);
    expect(screen.getByRole("button", { name: "Add to my library" })).toBeInTheDocument();
    expect(h.getMyCopy).toHaveBeenCalledWith("u1", RID, expect.anything());
  });

  it("offers Open book and the low-confidence line from the stored alignment", async () => {
    h.getMyCopy.mockResolvedValue({
      readId: RID,
      bookId: "book1",
      contentSha256: null,
      alignment: { map: {}, copyHrefs: [], confidence: 0.4, identity: false },
    });
    render(await ReadPage(params(GID, RID)));
    expect(screen.getByRole("link", { name: "Open book" })).toHaveAttribute("href", "/reader/book1");
    expect(screen.getByText(/don.t fully match/)).toBeInTheDocument();
  });
});
