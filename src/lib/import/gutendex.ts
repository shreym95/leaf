// Project Gutenberg import client via the Gutendex API (SPEC §6 — secondary).
//
// Endpoints (verified 2026-08 against the live API):
//   search:      https://gutendex.com/books/?search=<q>
//   single book: https://gutendex.com/books/<id>/   (trailing slash required —
//                without it Gutendex 301-redirects)
// The EPUB URL is `formats["application/epub+zip"]`, which points at
// gutenberg.org (e.g. `.../84.epub3.images`). All fetching is server-side.

import {
  IMPORT_USER_AGENT,
  normalizeAuthorName,
  type SearchResult,
} from "./types";

const GUTENDEX_BASE = "https://gutendex.com/books";
const EPUB_MIME = "application/epub+zip";

interface GutendexAuthor {
  name?: string;
}

interface GutendexBook {
  id: number;
  title?: string;
  authors?: GutendexAuthor[];
  formats?: Record<string, string>;
}

interface GutendexList {
  results?: GutendexBook[];
}

function authorOf(book: GutendexBook): string {
  return (book.authors ?? [])
    .map((a) => (a?.name ? normalizeAuthorName(a.name) : ""))
    .filter(Boolean)
    .join(", ");
}

function epubUrlOf(book: GutendexBook): string | undefined {
  const formats = book.formats ?? {};
  // Keys sometimes carry a charset suffix ("text/plain; charset=utf-8"); the
  // epub key is clean, but match defensively.
  const key =
    Object.keys(formats).find((k) => k.split(";")[0].trim() === EPUB_MIME) ??
    null;
  return key ? formats[key] : undefined;
}

function coverOf(book: GutendexBook): string | undefined {
  const formats = book.formats ?? {};
  const key = Object.keys(formats).find(
    (k) => k.split(";")[0].trim() === "image/jpeg",
  );
  return key ? formats[key] : undefined;
}

function toSearchResult(book: GutendexBook): SearchResult {
  return {
    source: "gutenberg",
    ref: String(book.id),
    title: (book.title ?? "").trim() || "Untitled",
    author: authorOf(book),
    coverUrl: coverOf(book),
  };
}

/** Search Project Gutenberg (via Gutendex). Returns [] for a blank query. */
export async function searchGutendex(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${GUTENDEX_BASE}/?search=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": IMPORT_USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Gutendex search failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as GutendexList;
  return (data.results ?? []).map(toSearchResult);
}

/** Fetch a single Gutendex record by id. */
async function fetchGutendexBook(id: string): Promise<GutendexBook> {
  if (!/^\d+$/.test(id)) {
    throw new Error(`Invalid Gutenberg id: "${id}"`);
  }
  const res = await fetch(`${GUTENDEX_BASE}/${id}/`, {
    headers: { "User-Agent": IMPORT_USER_AGENT, Accept: "application/json" },
  });
  if (res.status === 404) {
    throw new Error(`Gutenberg book ${id} not found`);
  }
  if (!res.ok) {
    throw new Error(`Gutendex lookup failed for ${id} (HTTP ${res.status})`);
  }
  return (await res.json()) as GutendexBook;
}

/** Resolve the `application/epub+zip` download URL for a Gutenberg id. */
export async function resolveGutenbergEpubUrl(id: string): Promise<string> {
  const book = await fetchGutendexBook(id);
  const url = epubUrlOf(book);
  if (!url) {
    throw new Error(`Gutenberg book ${id} has no EPUB edition`);
  }
  return url;
}

/** Server-fetch the EPUB bytes for a Gutenberg id. */
export async function fetchGutenbergEpub(id: string): Promise<ArrayBuffer> {
  const url = await resolveGutenbergEpubUrl(id);
  const res = await fetch(url, {
    headers: { "User-Agent": IMPORT_USER_AGENT },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(
      `Gutenberg download failed for ${id} (HTTP ${res.status})`,
    );
  }
  return res.arrayBuffer();
}
