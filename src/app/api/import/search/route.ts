// GET /api/import/search?q=<query>
//
// One search across both catalogs (SPEC §6). The reader shouldn't have to know
// or care which library a book comes from, so both are queried in parallel and
// the results are merged; each result carries its `source` for display.
//
// `source=<standardebooks|gutenberg>` still narrows to one catalog — kept for
// targeted debugging, not used by the UI.
//
// Merge rules:
//  - de-duplicate the same work appearing in both catalogs, preferring
//    Standard Ebooks (its markup is uniform, which is why SPEC §6 makes it
//    primary and why the reader renders it more consistently);
//  - interleave the rest so neither catalog buries the other;
//  - one catalog failing never sinks the other — the response reports which
//    sources were unavailable so the UI can say so.

import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import type { CatalogSource, SearchResult } from "@/lib/import/types";
import { searchStandardEbooks } from "@/lib/import/standard-ebooks";
import { searchGutendex } from "@/lib/import/gutendex";

export const runtime = "nodejs";

const SEARCHERS: Record<
  CatalogSource,
  (q: string) => Promise<SearchResult[]>
> = {
  standardebooks: searchStandardEbooks,
  gutenberg: searchGutendex,
};

/** Standard Ebooks first — it wins ties when the same work is in both. */
const ORDER: CatalogSource[] = ["standardebooks", "gutenberg"];

/** Loose identity for a work: title + author, punctuation and case removed. */
function workKey(r: SearchResult): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/^(the|a|an)\s+/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${norm(r.title)}|${norm(r.author)}`;
}

/** Round-robin the per-source lists so neither catalog buries the other. */
function interleave(lists: SearchResult[][]): SearchResult[] {
  const out: SearchResult[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

export async function GET(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { error: "You need to sign in first." },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const sourceParam = searchParams.get("source");

  if (!q) {
    return NextResponse.json({ results: [], unavailable: [] });
  }
  if (sourceParam !== null && !ORDER.includes(sourceParam as CatalogSource)) {
    return NextResponse.json(
      { error: "Unknown search source." },
      { status: 400 },
    );
  }

  const sources: CatalogSource[] = sourceParam
    ? [sourceParam as CatalogSource]
    : ORDER;

  const settled = await Promise.allSettled(sources.map((s) => SEARCHERS[s](q)));

  const perSource: SearchResult[][] = [];
  const unavailable: CatalogSource[] = [];
  const seen = new Set<string>();

  // Walk in ORDER so Standard Ebooks claims a work before Gutenberg can.
  settled.forEach((outcome, i) => {
    if (outcome.status !== "fulfilled") {
      unavailable.push(sources[i]);
      console.error(`[/api/import/search] ${sources[i]} failed`, outcome.reason);
      return;
    }
    const deduped: SearchResult[] = [];
    for (const r of outcome.value) {
      const key = workKey(r);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }
    perSource.push(deduped);
  });

  return NextResponse.json({ results: interleave(perSource), unavailable });
}
