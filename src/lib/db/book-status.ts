// Finished / unread state of a book (`books.status` + `books.finished_at`,
// migration 0007). Browser-safe: an EXPLICIT Supabase client, like
// `reading-state.ts`. It cannot live in `books.ts`, which imports server-only
// modules (`next/headers`) — and the offline outbox, which replays this write,
// ships in the client bundle.
//
// Both columns are always written together: the DB enforces
// `(status = 'finished') = (finished_at is not null)` (`books_finished_consistent`),
// so a write that sets one without the other is rejected.
//
// Security is RLS (owner-only on `books`); the explicit `user_id` filter is
// belt-and-braces, as elsewhere.

import type { SupabaseClient } from "@supabase/supabase-js";

function resolveClient(client?: SupabaseClient): SupabaseClient {
  if (client) return client;
  throw new Error(
    "book-status helpers require an explicit Supabase client (the browser client in the reader).",
  );
}

/**
 * Mark a book finished (`finishedAt` = ISO timestamp) or put it back to
 * unread (`null`).
 *
 * The finished path only touches a row that is NOT already finished
 * (`finished_at is null`), so the FIRST finish date is kept: finishing again
 * from the reader, or a stale offline replay arriving after a later finish, is
 * a harmless no-op rather than a rewrite of the date. The unread path is
 * unconditional — it is an explicit reader action, and is idempotent anyway.
 *
 * Throws on a Postgrest error, like its neighbours.
 */
export async function setBookFinished(
  userId: string,
  bookId: string,
  finishedAt: string | null,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = resolveClient(client);
  if (finishedAt === null) {
    const { error } = await supabase
      .from("books")
      .update({ status: "reading", finished_at: null })
      .eq("id", bookId)
      .eq("user_id", userId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from("books")
    .update({ status: "finished", finished_at: finishedAt })
    .eq("id", bookId)
    .eq("user_id", userId)
    .is("finished_at", null);
  if (error) throw error;
}
