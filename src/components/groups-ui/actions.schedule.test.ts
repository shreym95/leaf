import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setReadSchedule } from "./actions";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const url = "/api/groups/g1/reads/r1";

describe("setReadSchedule", () => {
  it("PATCHes the schedule as JSON to the read route", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ schedule: [] }) });
    await setReadSchedule("g1", "r1", [{ chapter_index: 2, due_on: "2026-03-01" }]);
    expect(fetchMock).toHaveBeenCalledWith(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schedule: [{ chapter_index: 2, due_on: "2026-03-01" }] }),
    });
  });

  it("sends null to clear the schedule", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ schedule: null }) });
    await setReadSchedule("g1", "r1", null);
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ schedule: null }));
  });

  it("throws the route's message on a 400", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Checkpoints must go in chapter order, with no repeats." }),
    });
    await expect(setReadSchedule("g1", "r1", [])).rejects.toThrow(
      "Checkpoints must go in chapter order, with no repeats.",
    );
  });

  it("throws the plain message on a 400 with no readable body", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    });
    await expect(setReadSchedule("g1", "r1", [])).rejects.toThrow("Couldn't save. Try again.");
  });

  it("throws the plain message on a 403 even when the body has text", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Only the group owner or the member who added it can change this read's schedule." }),
    });
    await expect(setReadSchedule("g1", "r1", null)).rejects.toThrow("Couldn't save. Try again.");
  });

  it("throws the plain message on a server error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Could not change the schedule." }),
    });
    await expect(setReadSchedule("g1", "r1", null)).rejects.toThrow("Couldn't save. Try again.");
  });

  it("throws the plain message when the network fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(setReadSchedule("g1", "r1", null)).rejects.toThrow("Couldn't save. Try again.");
  });
});
