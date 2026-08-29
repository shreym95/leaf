// Typed convenience wrappers over the `reading_state` table (SPEC §5, §8).
//
// These take an EXPLICIT Supabase client so the module stays browser-safe — the
// reader's position tracker (`src/reader/position.ts`) imports it into a client
// bundle, so it must never reach through to `@/lib/supabase/server` (which pulls
// `next/headers`). Callers provide the client:
//   - browser (position tracker): the browser client; RLS (`user_id =
//     auth.uid()`) scopes the write to the signed-in user.
//   - server (Route Handlers / Server Components): `await createClient()` from
//     `@/lib/supabase/server`.
//
// Security is RLS (owner-only, SPEC §3.3); the explicit `user_id` filters are
// belt-and-braces and keep the queries readable.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReadingState } from "@/lib/types";

function resolveClient(client?: SupabaseClient): SupabaseClient {
  if (client) return client;
  throw new Error(
    "reading-state helpers require an explicit Supabase client (browser client " +
      "in the reader, `await createClient()` from @/lib/supabase/server on the server).",
  );
}

/** The reading position for `bookId`, or null if the book was never opened. */
export async function getReadingState(
  userId: string,
  bookId: string,
  client?: SupabaseClient,
): Promise<ReadingState | null> {
  const supabase = await resolveClient(client);
  const { data, error } = await supabase
    .from("reading_state")
    .select("*")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .maybeSingle();
  if (error) throw error;
  return (data as ReadingState | null) ?? null;
}

/**
 * Save the reading position. Idempotent upsert on the composite PK
 * `(book_id, user_id)` — the latest write wins, which is exactly the
 * cross-device behaviour we want (SPEC §8: reopening on device B lands on
 * device A's last CFI).
 */
export async function upsertReadingState(
  userId: string,
  bookId: string,
  patch: { cfi: string; percent: number },
  client?: SupabaseClient,
): Promise<void> {
  const supabase = await resolveClient(client);
  const { error } = await supabase.from("reading_state").upsert(
    {
      user_id: userId,
      book_id: bookId,
      cfi: patch.cfi,
      percent: patch.percent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "book_id,user_id" },
  );
  if (error) throw error;
}
