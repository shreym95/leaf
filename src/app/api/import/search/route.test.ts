import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  se: vi.fn(),
  gutendex: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getUser: h.getUser }));
vi.mock("@/lib/import/standard-ebooks", () => ({ searchStandardEbooks: h.se }));
vi.mock("@/lib/import/gutendex", () => ({ searchGutendex: h.gutendex }));

import { GET } from "./route";

const req = (qs: string) =>
  new Request(`http://localhost:3000/api/import/search?${qs}`);

const seResult = (title: string, author = "Mary Shelley") => ({
  source: "standardebooks" as const,
  ref: `a/${title}`,
  title,
  author,
});
const pgResult = (title: string, author = "Mary Shelley") => ({
  source: "gutenberg" as const,
  ref: "84",
  title,
  author,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.getUser.mockResolvedValue({ id: "u1" });
  h.se.mockResolvedValue([]);
  h.gutendex.mockResolvedValue([]);
});

describe("GET /api/import/search", () => {
  it("401s when not signed in", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await GET(req("q=oz"))).status).toBe(401);
  });

  it("searches both catalogues from a single query", async () => {
    h.se.mockResolvedValue([seResult("Frankenstein")]);
    h.gutendex.mockResolvedValue([pgResult("Dracula", "Bram Stoker")]);

    const body = await (await GET(req("q=classic"))).json();

    expect(h.se).toHaveBeenCalledWith("classic");
    expect(h.gutendex).toHaveBeenCalledWith("classic");
    expect(body.results).toHaveLength(2);
    expect(body.unavailable).toEqual([]);
  });

  it("de-duplicates the same work, preferring Standard Ebooks", async () => {
    h.se.mockResolvedValue([seResult("Frankenstein")]);
    h.gutendex.mockResolvedValue([
      pgResult("The Frankenstein"), // same work, noisier title
      pgResult("Dracula", "Bram Stoker"),
    ]);

    const body = await (await GET(req("q=frank"))).json();

    const titles = body.results.map((r: { title: string }) => r.title);
    expect(titles).toContain("Frankenstein");
    expect(titles).not.toContain("The Frankenstein");
    expect(
      body.results.find((r: { title: string }) => r.title === "Frankenstein")
        .source,
    ).toBe("standardebooks");
  });

  it("interleaves so neither catalogue buries the other", async () => {
    h.se.mockResolvedValue([seResult("A", "x"), seResult("B", "x")]);
    h.gutendex.mockResolvedValue([pgResult("C", "y"), pgResult("D", "y")]);

    const body = await (await GET(req("q=z"))).json();

    expect(body.results.map((r: { source: string }) => r.source)).toEqual([
      "standardebooks",
      "gutenberg",
      "standardebooks",
      "gutenberg",
    ]);
  });

  it("one catalogue failing does not sink the other, and is reported", async () => {
    h.se.mockRejectedValue(new Error("opds down"));
    h.gutendex.mockResolvedValue([pgResult("Dracula", "Bram Stoker")]);

    const res = await GET(req("q=drac"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(body.unavailable).toEqual(["standardebooks"]);
  });

  it("returns nothing for a blank query without calling the catalogues", async () => {
    const body = await (await GET(req("q=%20"))).json();
    expect(body.results).toEqual([]);
    expect(h.se).not.toHaveBeenCalled();
    expect(h.gutendex).not.toHaveBeenCalled();
  });

  it("still supports narrowing to one source for debugging", async () => {
    h.gutendex.mockResolvedValue([pgResult("Dracula", "Bram Stoker")]);
    await GET(req("q=drac&source=gutenberg"));
    expect(h.se).not.toHaveBeenCalled();
    expect(h.gutendex).toHaveBeenCalledWith("drac");
  });

  it("400s on an unknown source", async () => {
    expect((await GET(req("q=x&source=libgen"))).status).toBe(400);
  });
});
