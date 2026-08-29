import { describe, it, expect, vi, afterEach } from "vitest";
import {
  searchGutendex,
  resolveGutenbergEpubUrl,
  fetchGutenbergEpub,
} from "./gutendex";

const SEARCH_SAMPLE = {
  count: 1,
  results: [
    {
      id: 84,
      title: "Frankenstein; Or, The Modern Prometheus",
      authors: [
        { name: "Shelley, Mary Wollstonecraft", birth_year: 1797, death_year: 1851 },
      ],
      formats: {
        "text/html": "https://www.gutenberg.org/ebooks/84.html.images",
        "application/epub+zip": "https://www.gutenberg.org/ebooks/84.epub3.images",
        "image/jpeg": "https://www.gutenberg.org/cache/epub/84/pg84.cover.medium.jpg",
        "text/plain; charset=us-ascii": "https://www.gutenberg.org/files/84/84-0.txt",
      },
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("searchGutendex", () => {
  it("returns [] for a blank query without hitting the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchGutendex("")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps Gutendex results (author name flipped, cover + ref set)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => SEARCH_SAMPLE,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchGutendex("frankenstein");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("https://gutendex.com/books/?search=frankenstein");
    expect(init.headers["User-Agent"]).toMatch(/^Leaf\//);

    expect(results).toEqual([
      {
        source: "gutenberg",
        ref: "84",
        title: "Frankenstein; Or, The Modern Prometheus",
        author: "Mary Wollstonecraft Shelley",
        coverUrl:
          "https://www.gutenberg.org/cache/epub/84/pg84.cover.medium.jpg",
      },
    ]);
  });
});

describe("resolveGutenbergEpubUrl", () => {
  it("looks up the book (trailing slash) and returns the epub format URL", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => SEARCH_SAMPLE.results[0],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const url = await resolveGutenbergEpubUrl("84");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://gutendex.com/books/84/",
    );
    expect(url).toBe("https://www.gutenberg.org/ebooks/84.epub3.images");
  });

  it("rejects a non-numeric id", async () => {
    await expect(resolveGutenbergEpubUrl("84abc")).rejects.toThrow(/Invalid/);
  });

  it("throws when the book has no epub edition", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 9, title: "x", formats: { "text/html": "u" } }),
      })),
    );
    await expect(resolveGutenbergEpubUrl("9")).rejects.toThrow(/no EPUB/);
  });

  it("throws a clear error on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
    await expect(resolveGutenbergEpubUrl("999999999")).rejects.toThrow(
      /not found/,
    );
  });
});

describe("fetchGutenbergEpub", () => {
  it("resolves the URL then downloads the bytes", async () => {
    const buf = new Uint8Array([80, 75, 3, 4]).buffer;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => SEARCH_SAMPLE.results[0],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => buf,
      });
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchGutenbergEpub("84")).toBe(buf);
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe(
      "https://www.gutenberg.org/ebooks/84.epub3.images",
    );
  });
});
