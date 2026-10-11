import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  enabled: true,
  createClient: vi.fn(() => ({})),
  resolveUserId: vi.fn(),
  findReadForBook: vi.fn(),
  getGroup: vi.fn(),
  getReadProgress: vi.fn(),
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
  getReadProgress: h.getReadProgress,
}));

import { useGroupMarkers } from "./useGroupMarkers";

const read = (id: string, groupId: string) => ({
  read: { id, group_id: groupId },
  copy: {},
});
const member = (user_id: string, display_name: string | null) => ({
  user_id,
  display_name,
  role: "member",
  joined_at: "2026-01-01T00:00:00Z",
});
const prog = (user_id: string, percent: number, updated_at: string) => ({
  read_id: "r",
  user_id,
  chapter_index: 0,
  chapter_fraction: 0,
  percent,
  finished_at: null,
  manual: false,
  updated_at,
});

beforeEach(() => {
  h.enabled = true;
  for (const f of [h.createClient, h.resolveUserId, h.findReadForBook, h.getGroup, h.getReadProgress]) {
    f.mockClear();
  }
  h.resolveUserId.mockResolvedValue("me");
  h.findReadForBook.mockResolvedValue([]);
  h.getGroup.mockResolvedValue(null);
  h.getReadProgress.mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe("useGroupMarkers", () => {
  it("flag off: no client, no queries, no listener, and []", async () => {
    h.enabled = false;
    const add = vi.spyOn(window, "addEventListener");
    const { result } = renderHook(() => useGroupMarkers("b1"));
    await act(async () => {});
    expect(result.current).toEqual([]);
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.resolveUserId).not.toHaveBeenCalled();
    expect(h.findReadForBook).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalledWith("focus", expect.anything());
  });

  it("book in no group: [] and no progress queries", async () => {
    const { result } = renderHook(() => useGroupMarkers("b1"));
    await waitFor(() => expect(h.findReadForBook).toHaveBeenCalledWith("me", "b1", expect.anything()));
    expect(result.current).toEqual([]);
    expect(h.getReadProgress).not.toHaveBeenCalled();
    expect(h.getGroup).not.toHaveBeenCalled();
  });

  it("returns other members with names and excludes self", async () => {
    h.findReadForBook.mockResolvedValue([read("r1", "g1")]);
    h.getGroup.mockResolvedValue({
      group: {},
      members: [member("me", "Me"), member("u2", "Ana"), member("u3", null)],
    });
    h.getReadProgress.mockResolvedValue([
      prog("me", 0.9, "2026-02-01T00:00:00Z"),
      prog("u2", 0.4, "2026-02-01T00:00:00Z"),
      prog("u3", 0.1, "2026-02-01T00:00:00Z"),
    ]);
    const { result } = renderHook(() => useGroupMarkers("b1"));
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current).toEqual([
      { userId: "u2", name: "Ana", percent: 0.4 },
      { userId: "u3", name: "Member", percent: 0.1 },
    ]);
  });

  it("merges a user seen in several groups, keeping the latest updated_at", async () => {
    h.findReadForBook.mockResolvedValue([read("r1", "g1"), read("r2", "g2")]);
    h.getGroup.mockImplementation(async (id: string) => ({
      group: {},
      members: [member("u2", id === "g1" ? "Ana" : "Ana B")],
    }));
    h.getReadProgress.mockImplementation(async (readId: string) =>
      readId === "r1"
        ? [prog("u2", 0.8, "2026-03-01T00:00:00Z")]
        : [prog("u2", 0.3, "2026-02-01T00:00:00Z")],
    );
    const { result } = renderHook(() => useGroupMarkers("b1"));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toMatchObject({ userId: "u2", percent: 0.8 });
  });

  it("skips progress rows of people who are not current members", async () => {
    h.findReadForBook.mockResolvedValue([read("r1", "g1")]);
    h.getGroup.mockResolvedValue({ group: {}, members: [member("u2", "Ana")] });
    h.getReadProgress.mockResolvedValue([
      prog("u2", 0.4, "2026-02-01T00:00:00Z"),
      prog("gone", 0.5, "2026-02-01T00:00:00Z"),
    ]);
    const { result } = renderHook(() => useGroupMarkers("b1"));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].userId).toBe("u2");
  });

  it("any error resolves to [], including after markers were shown", async () => {
    h.findReadForBook.mockResolvedValue([read("r1", "g1")]);
    h.getGroup.mockResolvedValue({ group: {}, members: [member("u2", "Ana")] });
    h.getReadProgress.mockResolvedValueOnce([prog("u2", 0.4, "2026-02-01T00:00:00Z")]);
    const { result } = renderHook(() => useGroupMarkers("b1"));
    await waitFor(() => expect(result.current).toHaveLength(1));

    h.getReadProgress.mockRejectedValue(new Error("boom"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("a throwing client never throws into the component", async () => {
    h.createClient.mockImplementationOnce(() => {
      throw new Error("not configured");
    });
    const { result } = renderHook(() => useGroupMarkers("b1"));
    await act(async () => {});
    expect(result.current).toEqual([]);
  });

  it("refetches on window focus and stops listening on unmount", async () => {
    const { unmount } = renderHook(() => useGroupMarkers("b1"));
    await waitFor(() => expect(h.findReadForBook).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(h.findReadForBook).toHaveBeenCalledTimes(2));
    unmount();
    window.dispatchEvent(new Event("focus"));
    await act(async () => {});
    expect(h.findReadForBook).toHaveBeenCalledTimes(2);
  });

  it("offline: makes no calls", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result } = renderHook(() => useGroupMarkers("b1"));
    await act(async () => {});
    expect(result.current).toEqual([]);
    expect(h.createClient).not.toHaveBeenCalled();
  });
});
