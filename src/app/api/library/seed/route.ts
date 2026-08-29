// POST /api/library/seed  (auth)
//
// Adds the bundled public-domain classics (public/bundled/) to the caller's
// library so a brand-new user has something to open immediately (SPEC §6 M2).
// Titles already present (matched by `source_ref`) are skipped, so the route is
// safe to call more than once.
//
// The EPUB bytes ship in the repo (fetched from Standard Ebooks at build time),
// so this never touches the network. Each file is handed to `ingestEpub`
// (Agent B) which stores it in the user's `epubs` bucket and inserts the row.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ingestEpub } from "@/lib/books/ingest";
import type { Book } from "@/lib/types";

interface ManifestEntry {
  sourceRef: string;
  title: string;
  author: string;
  file: string;
}
interface Manifest {
  books: ManifestEntry[];
}

const BUNDLED_DIR = path.join(process.cwd(), "public", "bundled");

export async function POST() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let manifest: Manifest;
  try {
    const raw = await readFile(
      path.join(BUNDLED_DIR, "manifest.json"),
      "utf8",
    );
    manifest = JSON.parse(raw) as Manifest;
  } catch {
    return NextResponse.json(
      { error: "Starter books are unavailable." },
      { status: 500 },
    );
  }

  const entries = manifest.books ?? [];
  const refs = entries.map((e) => e.sourceRef);

  // Skip anything the user already has (by source_ref). RLS scopes this to them.
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("books")
    .select("source_ref")
    .eq("user_id", user.id)
    .eq("source", "standardebooks")
    .in("source_ref", refs.length > 0 ? refs : ["__none__"]);
  const have = new Set(
    (existing ?? []).map((r: { source_ref: string | null }) => r.source_ref),
  );

  const added: Book[] = [];
  for (const entry of entries) {
    if (have.has(entry.sourceRef)) continue;
    try {
      const buf = await readFile(path.join(BUNDLED_DIR, entry.file));
      const bytes = new Uint8Array(
        buf.buffer,
        buf.byteOffset,
        buf.byteLength,
      );
      const book = await ingestEpub({
        userId: user.id,
        source: "standardebooks",
        sourceRef: entry.sourceRef,
        bytes,
        title: entry.title,
        author: entry.author,
      });
      added.push(book);
    } catch (err) {
      // One bad file shouldn't sink the batch — log and carry on.
      console.error(`[seed] failed to add ${entry.file}:`, err);
    }
  }

  return NextResponse.json({ added });
}
