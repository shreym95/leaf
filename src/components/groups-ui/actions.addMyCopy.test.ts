import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMyCopy } from "./actions";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("addMyCopy", () => {
  it("resolves with the alignment confidence", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ alignment: { confidence: 0.42 } }),
    });

    await expect(addMyCopy("g1", "r1", "b2")).resolves.toEqual({ confidence: 0.42 });
  });

  it("throws the server's message on other failures", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "That book has no readable text." }),
    });

    const err = await addMyCopy("g1", "r1", "b2").catch((e: unknown) => e);

    expect((err as Error).message).toBe("That book has no readable text.");
  });

  it("throws the plain message when the failure has no readable body", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    });

    await expect(addMyCopy("g1", "r1", "b2")).rejects.toThrow("Could not add your copy.");
  });
});
