// Typed convenience wrappers over the `books` table. Server-side only.
// Security is RLS (owner-only, SPEC §3.3) — the explicit `user_id` filters are
// belt-and-braces and keep the queries readable, not the security boundary.

import { createClient } from "@/lib/supabase/server";
import type { Book } from "@/lib/types";
import { signCoverUrls } from "@/lib/storage";
import { IS_DEMO } from "@/lib/demo/flag";
import {
  demoListBooks,
  demoGetBook,
  demoCountArchivedBooks,
} from "@/lib/demo/fixtures";

/**
 * A book plus where the reader left off. The shelf shows progress rather than a
 * status label, and orders by what was read most recently, so both come from
 * `reading_state`.
 */
export interface LibraryBook extends Book {
  /** 0–1 through the book, or null if it has never been opened. */
  percent: number | null;
  /** When it was last read, or null if never. */
  lastReadAt: string | null;
  /** A signed, short-lived URL for the extracted cover; null if there is none. */
  coverUrl: string | null;
}

interface BookRow extends Book {
  // PostgREST embeds a to-many relation as an array even when the composite
  // primary key makes it at most one row per book for this user.
  reading_state?:
    | { percent: number | null; updated_at: string | null }[]
    | { percent: number | null; updated_at: string | null }
    | null;
}

function toLibraryBook(row: BookRow): LibraryBook {
  const state = Array.isArray(row.reading_state)
    ? row.reading_state[0]
    : row.reading_state;
  const { reading_state: _ignored, ...book } = row;
  return {
    ...(book as Book),
    percent: state?.percent ?? null,
    lastReadAt: state?.updated_at ?? null,
    coverUrl: null, // filled in by listBooks, which signs the whole shelf at once
  };
}

/**
 * The user's library, most recently read first; books never opened come after,
 * newest addition first.
 *
 * Sorted here rather than in the query: ordering by an embedded relation is
 * fragile in PostgREST, and "last read, then recently added" is two keys with a
 * null-handling rule that reads far more clearly in code. Personal libraries are
 * small enough that this costs nothing.
 */
export async function listBooks(
  userId: string,
  { archived = false }: { archived?: boolean } = {},
): Promise<LibraryBook[]> {
  if (IS_DEMO) return demoListBooks({ archived });

  const supabase = await createClient();
  const query = supabase
    .from("books")
    .select("*, reading_state(percent, updated_at)")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });

  // Hidden books are a separate view, not mixed in — the point of hiding is a
  // shelf you can take in at a glance.
  const { data, error } = await (archived
    ? query.not("archived_at", "is", null)
    : query.is("archived_at", null));
  if (error) throw error;

  const books = ((data as BookRow[] | null) ?? []).map(toLibraryBook);

  // One signing call for the whole shelf rather than one per book.
  const signed = await signCoverUrls(
    books.map((b) => b.cover_path).filter((p): p is string => !!p),
  );
  for (const b of books) {
    b.coverUrl = b.cover_path ? (signed.get(b.cover_path) ?? null) : null;
  }

  return books.sort((a, b) => {
    if (a.lastReadAt && b.lastReadAt) {
      return b.lastReadAt.localeCompare(a.lastReadAt);
    }
    if (a.lastReadAt) return -1; // started books rise above untouched ones
    if (b.lastReadAt) return 1;
    return b.added_at.localeCompare(a.added_at);
  });
}

/** A single book by id, or null if it doesn't exist / isn't the user's. */
export async function getBook(
  userId: string,
  bookId: string,
): Promise<Book | null> {
  if (IS_DEMO) return demoGetBook(bookId);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .eq("user_id", userId)
    .eq("id", bookId)
    .maybeSingle();
  if (error) throw error;
  return (data as Book | null) ?? null;
}

/** Hide a book from the shelf, or put it back. Reversible; nothing is deleted. */
export async function setBookArchived(
  userId: string,
  bookId: string,
  archived: boolean,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("books")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", bookId)
    .eq("user_id", userId);
  if (error) throw error;
}

/** How many books the reader has hidden — so the shelf can offer to show them. */
export async function countArchivedBooks(userId: string): Promise<number> {
  if (IS_DEMO) return demoCountArchivedBooks();

  const supabase = await createClient();
  const { count, error } = await supabase
    .from("books")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("archived_at", "is", null);
  if (error) throw error;
  return count ?? 0;
}
