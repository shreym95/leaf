// PATCH /api/books/:id   { archived: boolean }  — hide from the shelf, or restore
// DELETE /api/books/:id                          — remove the book for good
//
// Hiding and deleting are deliberately different verbs. Hiding is reversible
// and keeps the file, the highlights and the reading position; deleting takes
// all of it. A shelf that only offered "delete" would make people keep books
// they don't want to see, or lose ones they only wanted out of the way.
//
// Ownership comes from the session, never the request: the row is matched on
// `id` AND `user_id`, so a valid id belonging to someone else simply matches
// nothing (and RLS would refuse it anyway).

import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { setBookArchived } from "@/lib/db/books";
import type { Book } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { error: "You need to sign in first." },
      { status: 401 },
    );
  }
  const { bookId } = await params;

  let archived: unknown;
  try {
    ({ archived } = (await request.json()) as { archived?: unknown });
  } catch {
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400 },
    );
  }
  if (typeof archived !== "boolean") {
    return NextResponse.json(
      { error: "`archived` must be true or false." },
      { status: 400 },
    );
  }

  try {
    await setBookArchived(user.id, bookId, archived);
    return NextResponse.json({ ok: true, archived });
  } catch (err) {
    console.error("[/api/books/:id] archive failed", err);
    return NextResponse.json(
      { error: "Could not update that book." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { error: "You need to sign in first." },
      { status: 401 },
    );
  }
  const { bookId } = await params;
  const supabase = await createClient();

  // Read first: we need the storage keys, and it confirms the book is theirs.
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .eq("id", bookId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[/api/books/:id] lookup failed", error);
    return NextResponse.json(
      { error: "Could not delete that book." },
      { status: 500 },
    );
  }
  const book = data as Book | null;
  if (!book) {
    return NextResponse.json({ error: "No such book." }, { status: 404 });
  }

  // Files first: an orphaned row is visible and fixable, an orphaned file is
  // invisible and bills the reader's storage quota forever.
  const paths = [book.storage_path, book.cover_path].filter(
    (p): p is string => !!p,
  );
  if (paths.length > 0) {
    const { error: rmError } = await supabase.storage
      .from("epubs")
      .remove(paths);
    if (rmError) {
      console.error("[/api/books/:id] storage cleanup failed", rmError);
      return NextResponse.json(
        { error: "Could not delete that book's files. Nothing was removed." },
        { status: 500 },
      );
    }
  }

  // `highlights` and `reading_state` cascade from `books` (0001_init.sql).
  const { error: delError } = await supabase
    .from("books")
    .delete()
    .eq("id", bookId)
    .eq("user_id", user.id);
  if (delError) {
    console.error("[/api/books/:id] delete failed", delError);
    return NextResponse.json(
      { error: "Could not delete that book." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
