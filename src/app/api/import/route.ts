// POST /api/import  { source: "standardebooks" | "gutenberg", ref: string }
//
// Server-side import (SPEC §6): resolve + fetch the third-party EPUB bytes here
// (never in the browser), then run the shared ingest pipeline (validate -> DRM
// gate -> metadata -> Storage -> `books` row). Returns `{ book }` on success.

import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import type { CatalogSource } from "@/lib/import/types";
import { fetchStandardEbooksEpub } from "@/lib/import/standard-ebooks";
import { fetchGutenbergEpub } from "@/lib/import/gutendex";
import {
  ingestEpub,
  DrmProtectedError,
  InvalidEpubError,
} from "@/lib/books/ingest";

export const runtime = "nodejs";

const CATALOG_SOURCES: CatalogSource[] = ["standardebooks", "gutenberg"];

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { error: "You need to sign in first." },
      { status: 401 },
    );
  }

  let body: { source?: unknown; ref?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400 },
    );
  }

  const { source, ref } = body;
  if (
    typeof source !== "string" ||
    !CATALOG_SOURCES.includes(source as CatalogSource)
  ) {
    return NextResponse.json(
      { error: "Unknown import source." },
      { status: 400 },
    );
  }
  if (typeof ref !== "string" || ref.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing book reference." },
      { status: 400 },
    );
  }
  const catalogSource = source as CatalogSource;
  const cleanRef = ref.trim();

  // 1. Fetch bytes from the catalog (server-side).
  let bytes: ArrayBuffer;
  try {
    bytes =
      catalogSource === "standardebooks"
        ? await fetchStandardEbooksEpub(cleanRef)
        : await fetchGutenbergEpub(cleanRef);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "Couldn't download that book from its source. Please try again later.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  // 2. Ingest.
  try {
    const book = await ingestEpub({
      userId: user.id,
      source: catalogSource,
      sourceRef: cleanRef,
      bytes,
    });
    return NextResponse.json({ book }, { status: 201 });
  } catch (err) {
    if (err instanceof DrmProtectedError) {
      return NextResponse.json({ error: err.userMessage }, { status: 422 });
    }
    if (err instanceof InvalidEpubError) {
      return NextResponse.json(
        { error: "That file isn't a readable EPUB." },
        { status: 422 },
      );
    }
    console.error("[/api/import] ingest failed", err);
    return NextResponse.json(
      { error: "Could not add the book. Please try again." },
      { status: 500 },
    );
  }
}
