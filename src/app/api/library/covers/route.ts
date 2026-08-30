// POST /api/library/covers — backfill covers for books that don't have one.
//
// Covers are extracted at import from M6 onward, but every book added before
// that has none, and re-importing a library to get pictures would be absurd.
// This re-reads the EPUBs already in the user's Storage folder and pulls the
// cover out of each.
//
// Best-effort per book: a file that carries no cover, or fails to parse, is
// skipped rather than failing the run — plenty of EPUBs simply have no cover.

import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { extractEpubCover } from "@/lib/epub/cover";
import { uploadCoverFile } from "@/lib/storage";
import type { Book } from "@/lib/types";

export const runtime = "nodejs";

/** Bounded so one request can't run past the function's time limit. */
const MAX_PER_RUN = 12;

export async function POST() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { error: "You need to sign in first." },
      { status: 401 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .eq("user_id", user.id)
    .is("cover_path", null)
    .limit(MAX_PER_RUN);
  if (error) {
    console.error("[/api/library/covers] list failed", error);
    return NextResponse.json(
      { error: "Could not read your library." },
      { status: 500 },
    );
  }

  const books = (data as Book[] | null) ?? [];
  let added = 0;

  for (const book of books) {
    if (!book.storage_path) continue;
    try {
      const { data: blob } = await supabase.storage
        .from("epubs")
        .download(book.storage_path);
      if (!blob) continue;

      const cover = await extractEpubCover(await blob.arrayBuffer());
      if (!cover) continue;

      const coverPath = await uploadCoverFile(
        user.id,
        book.id,
        cover.bytes,
        cover.mediaType,
        cover.extension,
      );
      const { error: updateError } = await supabase
        .from("books")
        .update({ cover_path: coverPath })
        .eq("id", book.id)
        .eq("user_id", user.id);
      if (!updateError) added += 1;
    } catch (err) {
      // One unreadable book must not sink the rest of the run.
      console.error("[/api/library/covers] skipped a book", err);
    }
  }

  return NextResponse.json({
    added,
    scanned: books.length,
    /** True when there may be more to do — the caller can run it again. */
    more: books.length === MAX_PER_RUN,
  });
}
