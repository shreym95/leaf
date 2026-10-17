import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  enabled: true,
  createClient: vi.fn(() => ({})),
  resolveUserId: vi.fn(),
  findReadForBook: vi.fn(),
  getGroup: vi.fn(),
}));

vi.mock("@/lib/groups/flag", () => ({
  get GROUPS_ENABLED() {
    return h.enabled;
  },
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: h.createClient }));
vi.mock("@/lib/offline/outbox", () => ({ resolveUserId: h.resolveUserId }));
vi.mock("@/lib/db/groups", () => ({
  findReadForBook: h.findReadForBook,
  getGroup: h.getGroup,
}));

import { useGroupReads } from "./useGroupReads";

const outline = [
  { index: 0, label: "One", depth: 0, partIndex: null, partLabel: null, href: "o1.xhtml" },
];
const linked = (readId: string, groupId: string, sha: string | null = "sha-mine") => ({
  read: { id: readId, group_id: groupId, outline },
  copy: {
    readId,
    bookId: "b1",
    contentSha256: sha,
    alignment: { map: { "c1.html": 0 }, copyHrefs: ["c1.html"], confidence: 1, identity: false },
  },
});

beforeEach(() => {
  h.enabled = true;
  for (const f of [h.createClient, h.resolveUserId, h.findReadForBook, h.getGroup]) {
    f.mockClear();
  }
  h.resolveUserId.mockResolvedValue("me");
  h.findReadForBook.mockResolvedValue([]);
  h.getGroup.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("useGroupReads", () => {
  it("with the flag off, makes no client, no query and returns null", async () => {
    h.enabled = false;
    const { result } = renderHook(() => useGroupReads("b1"));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.resolveUserId).not.toHaveBeenCalled();
    expect(h.findReadForBook).not.toHaveBeenCalled();
    expect(h.getGroup).not.toHaveBeenCalled();
  });

  it("returns null when the book is linked to no read", async () => {
    const { result } = renderHook(() => useGroupReads("b1"));
    await waitFor(() => expect(h.findReadForBook).toHaveBeenCalledWith("me", "b1", {}));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
    expect(h.getGroup).not.toHaveBeenCalled();
  });

  it("resolves the linked reads with group names, member names and my copy hash", async () => {
    h.findReadForBook.mockResolvedValue([linked("r1", "g1"), linked("r2", "g2", null)]);
    h.getGroup.mockImplementation(async (id: string) => ({
      group: { id, name: id === "g1" ? "Book Club" : "Night Owls", created_at: "" },
      members: [
        { user_id: "u-ann", display_name: " Ann ", role: "owner", joined_at: "" },
        { user_id: "u-bob", display_name: null, role: "member", joined_at: "" },
      ],
    }));
    const { result } = renderHook(() => useGroupReads("b1"));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.userId).toBe("me");
    const [first, second] = result.current!.reads;
    expect(first).toMatchObject({ readId: "r1", groupName: "Book Club", copySha256: "sha-mine" });
    expect(second).toMatchObject({ readId: "r2", groupName: "Night Owls", copySha256: null });
    expect(first.names.get("u-ann")).toBe("Ann");
    expect(first.names.get("u-bob")).toBe("Member");
  });

  it("resolves to null when the lookup fails, so reading is unaffected", async () => {
    h.findReadForBook.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useGroupReads("b1"));
    await waitFor(() => expect(h.findReadForBook).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
  });
});
