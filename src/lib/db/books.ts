// Typed convenience wrappers over the `books` table. Server-side only.
// Security is RLS (owner-only, SPEC §3.3) — the explicit `user_id` filters are
// belt-and-braces and keep the queries readable, not the security boundary.

import { createClient } from "@/lib/supabase/server";
import type { Book } from "@/lib/types";

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
export async function listBooks(userId: string): Promise<LibraryBook[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("books")
    .select("*, reading_state(percent, updated_at)")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });
  if (error) throw error;

  const books = ((data as BookRow[] | null) ?? []).map(toLibraryBook);

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
