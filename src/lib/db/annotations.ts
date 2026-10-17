// Typed convenience wrappers over the `annotations` table (0012, NOTES_PLAN §4.1).
//
// Like `bookmarks.ts`, these take an EXPLICIT Supabase client so the module stays
// browser-safe. Callers provide the client:
//   - browser (reader annotation manager): the browser client.
//   - server (Route Handlers / Server Components): `await createClient()` from
//     `@/lib/supabase/server`.
//
// Security is RLS (owner-only, 0012). The rows are scoped to the signed-in user by
// the policy, so these functions take no user id on reads, updates or deletes. A
// create takes `userId` because the insert must name its owner (`user_id = auth.uid()`).
//
// Client-side checks below mirror the database checks (0012) so a bad value fails
// before a round trip. The database remains the guard.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Annotation, AnnotationKind } from "@/lib/types";

/** Note length cap, in characters (`char_length`), 1–500 when present (§4.1). */
export const ANNOTATION_NOTE_MAX = 500;

/** Client-side cap on a `range` quote, in characters (§4.1). The database has no cap. */
export const ANNOTATION_QUOTE_MAX = 5000;

function resolveClient(client?: SupabaseClient): SupabaseClient {
  if (client) return client;
  throw new Error(
    "annotations helpers require an explicit Supabase client (browser client " +
      "in the reader, `await createClient()` from @/lib/supabase/server on the server).",
  );
}

/** Length in characters, counted the way Postgres `char_length` counts them (code points). */
function charLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Throws unless `note` is null or 1–500 characters. A note is never empty:
 * clearing a note is `null`, not `""`.
 */
export function validateAnnotationNote(note: string | null): void {
  if (note === null) return;
  const length = charLength(note);
  if (length < 1 || length > ANNOTATION_NOTE_MAX) {
    throw new RangeError(
      `annotation note must be 1–${ANNOTATION_NOTE_MAX} characters (got ${length})`,
    );
  }
}

/**
 * Throws unless the kind and quote agree: a `range` needs a non-empty quote of at
 * most 5000 characters, and a `page` carries no quote.
 */
export function validateAnnotationQuote(kind: AnnotationKind, quote: string | null | undefined): void {
  if (kind === "page") {
    if (quote !== null && quote !== undefined) {
      throw new RangeError("a page annotation carries no quote");
    }
    return;
  }
  if (typeof quote !== "string" || quote.length === 0) {
    throw new RangeError("a range annotation needs a quote");
  }
  const length = charLength(quote);
  if (length > ANNOTATION_QUOTE_MAX) {
    throw new RangeError(
      `annotation quote must be at most ${ANNOTATION_QUOTE_MAX} characters (got ${length})`,
    );
  }
}

/** Every annotation for `bookId`, oldest first. RLS scopes the rows to the caller. */
export async function listAnnotations(
  bookId: string,
  client?: SupabaseClient,
): Promise<Annotation[]> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("annotations")
    .select("*")
    .eq("book_id", bookId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as Annotation[] | null) ?? [];
}

/** Fields the caller supplies when creating an annotation. */
export interface CreateAnnotationInput {
  /**
   * Client-supplied id, so an outbox entry keeps the same id on replay (§3).
   * Omit it to let the database generate one.
   */
  id?: string;
  /** Owner. The insert must name the signed-in user (RLS `user_id = auth.uid()`). */
  userId: string;
  bookId: string;
  kind: AnnotationKind;
  /** epub.js CFI: the page start for `page`, the range for `range`. */
  cfi: string;
  /** Selected text. Required for `range`, must be absent for `page`. */
  quote?: string | null;
  /** 1–500 characters, or null / omitted for none. */
  note?: string | null;
  /** Chapter title at creation. Null when unknown. */
  label?: string | null;
  /** 0–1 progress at creation. Null when unknown. */
  percent?: number | null;
}

/** Insert an annotation and return the stored row. Validates before the round trip. */
export async function createAnnotation(
  input: CreateAnnotationInput,
  client?: SupabaseClient,
): Promise<Annotation> {
  const quote = input.quote ?? null;
  const note = input.note ?? null;
  validateAnnotationQuote(input.kind, quote);
  validateAnnotationNote(note);

  const supabase = resolveClient(client);
  const row = {
    ...(input.id !== undefined ? { id: input.id } : {}),
    user_id: input.userId,
    book_id: input.bookId,
    kind: input.kind,
    cfi: input.cfi,
    quote,
    note,
    label: input.label ?? null,
    percent: input.percent ?? null,
  };
  const { data, error } = await supabase
    .from("annotations")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as Annotation;
}

/**
 * Set (or clear, with `null`) the note on one annotation. The database trigger
 * stamps `updated_at` and copies the note to a shared group copy (0012).
 */
export async function updateAnnotationNote(
  id: string,
  note: string | null,
  client?: SupabaseClient,
): Promise<void> {
  validateAnnotationNote(note);
  const supabase = resolveClient(client);
  const { error } = await supabase
    .from("annotations")
    .update({ note })
    .eq("id", id);
  if (error) throw error;
}

/** Delete one annotation. Its shared group copy is removed by the cascade (0012). */
export async function deleteAnnotation(id: string, client?: SupabaseClient): Promise<void> {
  const supabase = resolveClient(client);
  const { error } = await supabase.from("annotations").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Offline cache (N1e). Not implemented in N1a. Cache functions go here.
// ---------------------------------------------------------------------------
