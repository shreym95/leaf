// Standard Ebooks import client (SPEC §6 — primary source).
//
// Search uses the public OPDS *search* feed:
//   https://standardebooks.org/feeds/opds/all?query=<q>
// Note (verified 2026-08 against the live site): the *crawlable* OPDS feeds
// (`/feeds/opds/all` with no query, `/feeds/opds/subjects`, ...) now return 401
// and are gated behind the Patrons Circle. The `?query=` search feed and the
// New Releases feeds remain open to everyone, which is all M2 needs.
//
// Downloads must carry `?source=feed` — the bare `/downloads/*.epub` URL serves
// an HTML "Your download has started" interstitial instead of the bytes.
//
// All fetching is server-side (SPEC §6); the client never touches SE bytes.

import { XMLParser } from "fast-xml-parser";
import {
  IMPORT_USER_AGENT,
  type SearchResult,
} from "./types";
import { outboundFetch } from "./http";

const OPDS_SEARCH_URL = "https://standardebooks.org/feeds/opds/all";
const EBOOKS_BASE = "https://standardebooks.org/ebooks/";
const EPUB_MIME = "application/epub+zip";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (name) => name === "entry" || name === "link" || name === "author",
});

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** `https://standardebooks.org/ebooks/mary-shelley/frankenstein` -> slug. */
function slugFromEntryId(id: string): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed.startsWith(EBOOKS_BASE)) return null;
  const slug = trimmed.slice(EBOOKS_BASE.length).replace(/\/+$/, "");
  // Expect exactly "author-slug/title-slug".
  return /^[^/]+\/[^/]+$/.test(slug) ? slug : null;
}

interface OpdsLink {
  "@_href"?: string;
  "@_rel"?: string;
  "@_type"?: string;
  "@_title"?: string;
}

interface OpdsEntry {
  id?: string;
  title?: string | { "#text"?: string };
  author?: Array<{ name?: string }>;
  link?: OpdsLink[];
}

function textOf(v: string | { "#text"?: string } | undefined): string {
  if (v == null) return "";
  return (typeof v === "string" ? v : (v["#text"] ?? "")).trim();
}

function coverUrlFromLinks(links: OpdsLink[]): string | undefined {
  const thumb = links.find(
    (l) => l["@_rel"] === "http://opds-spec.org/image/thumbnail",
  );
  const full = links.find((l) => l["@_rel"] === "http://opds-spec.org/image");
  return thumb?.["@_href"] ?? full?.["@_href"];
}

function parseOpds(xml: string): SearchResult[] {
  const doc = parser.parse(xml) as { feed?: { entry?: OpdsEntry[] } };
  const entries = toArray(doc.feed?.entry);
  const out: SearchResult[] = [];
  for (const entry of entries) {
    const ref = slugFromEntryId(entry.id ?? "");
    if (!ref) continue;
    const title = textOf(entry.title);
    if (!title) continue;
    const author = toArray(entry.author)
      .map((a) => (a?.name ?? "").trim())
      .filter(Boolean)
      .join(", ");
    out.push({
      source: "standardebooks",
      ref,
      title,
      author,
      coverUrl: coverUrlFromLinks(toArray(entry.link)),
    });
  }
  return out;
}

/**
 * The recommended `application/epub+zip` download URL for a slug, with the
 * `?source=feed` marker that yields raw bytes. Filename convention (stable, used
 * by SE's own OPDS feed): `<author-slug>_<title-slug>.epub`.
 */
export function resolveStandardEbooksEpubUrl(ref: string): string {
  const slug = ref.trim().replace(/^\/+|\/+$/g, "");
  if (!/^[^/]+\/[^/]+$/.test(slug)) {
    throw new Error(`Invalid Standard Ebooks ref: "${ref}"`);
  }
  const file = slug.split("/").join("_");
  return `${EBOOKS_BASE}${slug}/downloads/${file}.epub?source=feed`;
}

async function opdsFetch(query: string): Promise<string> {
  const url = `${OPDS_SEARCH_URL}?query=${encodeURIComponent(query)}`;
  const res = await outboundFetch(url, {
    headers: { "User-Agent": IMPORT_USER_AGENT, Accept: "application/atom+xml" },
  });
  if (!res.ok) {
    throw new Error(`Standard Ebooks search failed (HTTP ${res.status})`);
  }
  return res.text();
}

/** Search the Standard Ebooks catalog. Returns [] for a blank query. */
export async function searchStandardEbooks(
  query: string,
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  return parseOpds(await opdsFetch(q));
}

/** Server-fetch the EPUB bytes for a slug. */
export async function fetchStandardEbooksEpub(ref: string): Promise<ArrayBuffer> {
  const url = resolveStandardEbooksEpubUrl(ref);
  const res = await outboundFetch(url, {
    headers: { "User-Agent": IMPORT_USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(
      `Standard Ebooks download failed for "${ref}" (HTTP ${res.status})`,
    );
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes(EPUB_MIME) && !type.includes("octet-stream")) {
    throw new Error(
      `Standard Ebooks returned "${type || "unknown"}" instead of an EPUB for "${ref}"`,
    );
  }
  return res.arrayBuffer();
}
