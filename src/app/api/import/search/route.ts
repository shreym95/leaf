// GET /api/import/search?q=<query>&source=<standardebooks|gutenberg>
//
// Catalog search (SPEC §6). `source` is optional — omitted searches both
// Standard Ebooks and Project Gutenberg (SE first, its markup is cleaner).
// Returns `{ results: SearchResult[] }`. A failure in one source doesn't sink
// the other.

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

const ORDER: CatalogSource[] = ["standardebooks", "gutenberg"];

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
    return NextResponse.json({ results: [] });
  }
  if (
    sourceParam !== null &&
    !ORDER.includes(sourceParam as CatalogSource)
  ) {
    return NextResponse.json(
      { error: "Unknown search source." },
      { status: 400 },
    );
  }

  const sources: CatalogSource[] = sourceParam
    ? [sourceParam as CatalogSource]
    : ORDER;

  const settled = await Promise.allSettled(
    sources.map((s) => SEARCHERS[s](q)),
  );

  const results: SearchResult[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      results.push(...outcome.value);
    } else {
      console.error(
        `[/api/import/search] ${sources[i]} failed`,
        outcome.reason,
      );
    }
  });

  return NextResponse.json({ results });
}
