// Typed convenience wrappers over the `highlights` table (SPEC §5, §8).
//
// Like `reading-state.ts`, these take an EXPLICIT Supabase client so the module
// stays browser-safe — the reader's highlight manager (`src/reader/highlights.ts`)
// imports it into a client bundle, so it must never reach through to
// `@/lib/supabase/server` (which pulls `next/headers`). Callers provide the client:
//   - browser (highlight manager): the browser client; RLS (`user_id =
//     auth.uid()`) scopes every read/write to the signed-in user.
//   - server (Route Handlers / Server Components): `await createClient()` from
//     `@/lib/supabase/server`.
//
// Security is RLS (owner-only, SPEC §3.3); the explicit `user_id` filters are
// belt-and-braces and keep the queries readable.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Highlight } from "@/lib/types";

function resolveClient(client?: SupabaseClient): SupabaseClient {
  if (client) return client;
  throw new Error(
    "highlights helpers require an explicit Supabase client (browser client " +
      "in the reader, `await createClient()` from @/lib/supabase/server on the server).",
  );
}

/** Every highlight for `bookId`, oldest first. */
export async function listHighlights(
  userId: string,
  bookId: string,
  client?: SupabaseClient,
): Promise<Highlight[]> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("highlights")
    .select("*")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as Highlight[] | null) ?? [];
}

/** Fields the caller supplies when creating a highlight. */
export interface CreateHighlightInput {
  bookId: string;
  cfiRange: string;
  text: string;
  /** Colour NAME (e.g. `'copper'`) — never a hex; the DB column is free text. */
  color: string;
  note?: string | null;
}

/** Insert a highlight and return the stored row (with its generated id + CFI). */
export async function createHighlight(
  userId: string,
  input: CreateHighlightInput,
  client?: SupabaseClient,
): Promise<Highlight> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("highlights")
    .insert({
      user_id: userId,
      book_id: input.bookId,
      cfi_range: input.cfiRange,
      text: input.text,
      color: input.color,
      note: input.note ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Highlight;
}

/** Set (or clear, with `null`) the note on one highlight. */
export async function updateHighlightNote(
  userId: string,
  id: string,
  note: string | null,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = resolveClient(client);
  const { error } = await supabase
    .from("highlights")
    .update({ note })
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw error;
}

/** Delete one highlight. */
export async function deleteHighlight(
  userId: string,
  id: string,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = resolveClient(client);
  const { error } = await supabase
    .from("highlights")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw error;
}
