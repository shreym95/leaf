// Typed convenience wrappers over the `bookmarks` table (0005). Mirrors
// `highlights.ts` in shape and reasoning.
//
// These take an EXPLICIT Supabase client so the module stays browser-safe — the
// reader's bookmark manager (`src/reader/bookmarks.ts`) imports it into a client
// bundle, so it must never reach through to `@/lib/supabase/server` (which pulls
// `next/headers`). Callers provide the client:
//   - browser (bookmark manager): the browser client; RLS (`user_id =
//     auth.uid()`) scopes every read/write to the signed-in user.
//   - server (Route Handlers / Server Components): `await createClient()` from
//     `@/lib/supabase/server`.
//
// Security is RLS (owner-only, SPEC §3.3); the explicit `user_id` filters are
// belt-and-braces and keep the queries readable.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bookmark } from "@/lib/types";

function resolveClient(client?: SupabaseClient): SupabaseClient {
  if (client) return client;
  throw new Error(
    "bookmarks helpers require an explicit Supabase client (browser client " +
      "in the reader, `await createClient()` from @/lib/supabase/server on the server).",
  );
}

/** Every bookmark for `bookId`, oldest first. */
export async function listBookmarks(
  userId: string,
  bookId: string,
  client?: SupabaseClient,
): Promise<Bookmark[]> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("bookmarks")
    .select("*")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as Bookmark[] | null) ?? [];
}

/** Fields the caller supplies when creating a bookmark. */
export interface CreateBookmarkInput {
  bookId: string;
  /** epub.js CFI of the page start. */
  cfi: string;
  /** Chapter title at save time — denormalised (0005). Null when unknown. */
  label?: string | null;
  /** 0–1 progress at save time — denormalised (0005). Null when unknown. */
  percent?: number | null;
}

/** Insert a bookmark and return the stored row (with its generated id). */
export async function createBookmark(
  userId: string,
  input: CreateBookmarkInput,
  client?: SupabaseClient,
): Promise<Bookmark> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("bookmarks")
    .insert({
      user_id: userId,
      book_id: input.bookId,
      cfi: input.cfi,
      label: input.label ?? null,
      percent: input.percent ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Bookmark;
}

/** Delete one bookmark. */
export async function deleteBookmark(
  userId: string,
  id: string,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = resolveClient(client);
  const { error } = await supabase
    .from("bookmarks")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw error;
}
