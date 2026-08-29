import { describe, it, expect, vi, afterEach } from "vitest";
import {
  searchStandardEbooks,
  resolveStandardEbooksEpubUrl,
  fetchStandardEbooksEpub,
} from "./standard-ebooks";

const OPDS_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:schema="http://schema.org/">
  <title>Search Results</title>
  <entry>
    <id>https://standardebooks.org/ebooks/mary-shelley/frankenstein</id>
    <dc:identifier>https://standardebooks.org/ebooks/mary-shelley/frankenstein</dc:identifier>
    <title>Frankenstein</title>
    <author><name>Mary Shelley</name><uri>https://standardebooks.org/ebooks/mary-shelley</uri></author>
    <link href="https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/cover.jpg" rel="http://opds-spec.org/image" type="image/jpeg"/>
    <link href="https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/cover-thumbnail.jpg" rel="http://opds-spec.org/image/thumbnail" type="image/jpeg"/>
    <link href="https://standardebooks.org/ebooks/mary-shelley/frankenstein" rel="alternate" type="application/xhtml+xml"/>
    <link href="https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/mary-shelley_frankenstein.epub?source=feed" rel="http://opds-spec.org/acquisition/open-access" title="Recommended compatible epub" type="application/epub+zip"/>
    <link href="https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/mary-shelley_frankenstein.kepub.epub?source=feed" rel="http://opds-spec.org/acquisition/open-access" title="Kobo Kepub epub" type="application/kepub+zip"/>
  </entry>
  <entry>
    <id>https://standardebooks.org/ebooks/omar-khayyam/the-rubaiyat-of-omar-khayyam/edward-fitzgerald</id>
    <title>The Rubáiyát of Omar Khayyám</title>
    <author><name>Omar Khayyám</name></author>
    <author><name>Edward FitzGerald</name></author>
    <link href="https://standardebooks.org/ebooks/omar-khayyam/the-rubaiyat-of-omar-khayyam/edward-fitzgerald/downloads/x.epub?source=feed" rel="http://opds-spec.org/acquisition/open-access" type="application/epub+zip"/>
  </entry>
</feed>`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("searchStandardEbooks", () => {
  it("returns [] for a blank query without hitting the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchStandardEbooks("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses OPDS entries into SearchResults", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => OPDS_SAMPLE,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchStandardEbooks("frankenstein");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe(
      "https://standardebooks.org/feeds/opds/all?query=frankenstein",
    );
    expect(init.headers["User-Agent"]).toMatch(/^Leaf\//);

    expect(results[0]).toEqual({
      source: "standardebooks",
      ref: "mary-shelley/frankenstein",
      title: "Frankenstein",
      author: "Mary Shelley",
      coverUrl:
        "https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/cover-thumbnail.jpg",
    });
    // Second entry: 3-segment slug is skipped (not "author/title").
    expect(results).toHaveLength(1);
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, text: async () => "" })),
    );
    await expect(searchStandardEbooks("x")).rejects.toThrow(/HTTP 503/);
  });
});

describe("resolveStandardEbooksEpubUrl", () => {
  it("builds the ?source=feed download URL from a slug", () => {
    expect(resolveStandardEbooksEpubUrl("mary-shelley/frankenstein")).toBe(
      "https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/mary-shelley_frankenstein.epub?source=feed",
    );
  });

  it("rejects a malformed ref", () => {
    expect(() => resolveStandardEbooksEpubUrl("not-a-slug")).toThrow();
  });
});

describe("fetchStandardEbooksEpub", () => {
  it("returns the ArrayBuffer when the content-type is an EPUB", async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/epub+zip" },
        arrayBuffer: async () => buf,
      })),
    );
    expect(await fetchStandardEbooksEpub("mary-shelley/frankenstein")).toBe(buf);
  });

  it("throws when SE serves an HTML interstitial instead of bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/xhtml+xml; charset=utf-8" },
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );
    await expect(
      fetchStandardEbooksEpub("mary-shelley/frankenstein"),
    ).rejects.toThrow(/instead of an EPUB/);
  });
});
