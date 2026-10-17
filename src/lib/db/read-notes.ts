// Client-side data layer for group notes: page marks and notes on a group read
// (0010 `read_notes`).
//
// Reads go through `visible_notes(rid)`, the only way a member sees another member's
// notes. The database returns a note only when it sits at or behind the caller's own
// progress, so the spoiler gate is not in this module. Direct selects on `read_notes`
// return the caller's own rows only (RLS).
//
// Like the other db modules these take an EXPLICIT Supabase client, so the module stays
// browser-safe. Errors follow the neighbours: a Postgrest error is thrown. Nothing logs.
// Security is RLS; the explicit `user_id` is belt-and-braces.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Annotation, ReadNote, ReadNoteKind, VisibleReadNote } from "@/lib/types";

/** Longest note, in characters (code points, as Postgres counts them). */
export const NOTE_MAX = 500;

/** Longest shared quote, in characters (code points). read_notes.quote_exact check (0012, §4.3). */
export const QUOTE_SHARE_MAX = 300;

/** Longest shared prefix or suffix, in characters (code points). §4.3. */
export const QUOTE_CONTEXT_MAX = 32;

/** Postgres unique_violation: the (annotation_id, read_id) index already has the row. */
const UNIQUE_VIOLATION = "23505";

function resolveClient(client?: SupabaseClient): SupabaseClient {
  if (client) return client;
  throw new Error(
    "read-notes helpers require an explicit Supabase client (the browser client in the " +
      "reader, `await createClient()` from @/lib/supabase/server on the server).",
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Chapter index as a non-negative integer, fraction in [0, 1]. Non-finite values become 0. */
function clampPosition(position: { chapterIndex: number; chapterFraction: number }): {
  chapterIndex: number;
  chapterFraction: number;
} {
  return {
    chapterIndex: Number.isFinite(position.chapterIndex)
      ? Math.max(0, Math.trunc(position.chapterIndex))
      : 0,
    chapterFraction: clamp01(position.chapterFraction),
  };
}

/** What `addReadNote` writes. v1 writes `mark` and `note` only; `highlight` is v2. */
export interface AddReadNoteInput {
  readId: string;
  userId: string;
  position: { chapterIndex: number; chapterFraction: number };
  kind: "mark" | "note";
  /** Required for `note` (1–500 characters after trimming); must be absent for `mark`. */
  note?: string | null;
  cfi?: string | null;
  contentSha256?: string | null;
}

/**
 * Validate a note's text for its kind. Returns the value to store: trimmed text for a
 * `note`, null for a `mark`. Throws before anything is sent.
 */
export function normaliseNoteText(kind: ReadNoteKind, note: string | null | undefined): string | null {
  if (kind === "highlight") {
    throw new Error("Highlights are not available in this version.");
  }
  if (kind === "mark") {
    if (note !== undefined && note !== null && note !== "") {
      throw new Error("A page mark cannot carry text.");
    }
    return null;
  }
  const trimmed = typeof note === "string" ? note.trim() : "";
  const length = Array.from(trimmed).length;
  if (length < 1 || length > NOTE_MAX) {
    throw new Error(`A note must be 1 to ${NOTE_MAX} characters.`);
  }
  return trimmed;
}

/**
 * Visible notes on a read, in position order: my own notes plus other members' notes
 * at or behind my progress (or all of them once I have finished). Rows come back in
 * the `visible_notes` shape, without the v2 quote columns.
 */
export async function listVisibleNotes(
  readId: string,
  client?: SupabaseClient,
): Promise<VisibleReadNote[]> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase.rpc("visible_notes", { rid: readId });
  if (error) throw error;
  return (data as VisibleReadNote[] | null) ?? [];
}

/**
 * Add a page mark or a note at my position. Validates the text before sending, clamps
 * the position into range (as `setGroupProgress` does), and returns the stored row.
 */
export async function addReadNote(
  input: AddReadNoteInput,
  client?: SupabaseClient,
): Promise<ReadNote> {
  const supabase = resolveClient(client);
  const note = normaliseNoteText(input.kind, input.note);
  const position = clampPosition(input.position);

  const { data, error } = await supabase
    .from("read_notes")
    .insert({
      read_id: input.readId,
      user_id: input.userId,
      chapter_index: position.chapterIndex,
      chapter_fraction: position.chapterFraction,
      kind: input.kind,
      note,
      cfi: input.cfi ?? null,
      content_sha256: input.contentSha256 ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ReadNote;
}

/** Delete one of my notes. RLS allows the owner only; a note that is not mine is a no-op. */
export async function deleteReadNote(id: string, client?: SupabaseClient): Promise<void> {
  const supabase = resolveClient(client);
  const { error } = await supabase.from("read_notes").delete().eq("id", id);
  if (error) throw error;
}

/** The quote anchors written to a shared highlight. */
export interface ShareQuote {
  quote_exact: string;
  quote_prefix: string;
  quote_suffix: string;
  /** True when the quote was longer than QUOTE_SHARE_MAX and was cut. */
  truncated: boolean;
}

/**
 * Cut a selected quote and its surrounding text for the group copy (NOTES_PLAN §4.3).
 * Lengths count code points, as Postgres does, so a surrogate pair is never split.
 *
 * - `quote_exact`: the first 300 code points. When the quote is cut, trailing whitespace
 *   is trimmed from the cut text. A quote that is not cut is returned unchanged.
 * - `quote_prefix`: the last 32 code points of `prefix` (the text nearest the quote).
 * - `quote_suffix`: the first 32 code points of `suffix`. When the quote is cut, this is
 *   "": the text after the cut is not the real suffix of the shared quote, so it is
 *   dropped rather than shared as if it were.
 */
export function shareQuote(quote: string, prefix: string, suffix: string): ShareQuote {
  const chars = Array.from(quote);
  const truncated = chars.length > QUOTE_SHARE_MAX;
  const quote_exact = truncated
    ? chars.slice(0, QUOTE_SHARE_MAX).join("").replace(/\s+$/u, "")
    : quote;
  const quote_prefix = Array.from(prefix).slice(-QUOTE_CONTEXT_MAX).join("");
  const quote_suffix = truncated
    ? ""
    : Array.from(suffix).slice(0, QUOTE_CONTEXT_MAX).join("");
  return { quote_exact, quote_prefix, quote_suffix, truncated };
}

/** What `shareAnnotation` shares: a personal item, the reader's position, and its context. */
export interface ShareAnnotationInput {
  annotation: Pick<Annotation, "id" | "kind" | "cfi" | "quote" | "note">;
  readId: string;
  userId: string;
  position: { chapterIndex: number; chapterFraction: number };
  contentSha256?: string | null;
  /** Text before the quote. Used for `range` only. */
  prefix?: string | null;
  /** Text after the quote. Used for `range` only. */
  suffix?: string | null;
}

export interface ShareAnnotationResult {
  /** The `read_notes` row id: the new row, or the existing one when already shared. */
  id: string;
  /** True when the shared quote was cut to 300 characters. Always false for a `page`. */
  truncated: boolean;
}

/**
 * Share a personal item to a group read by writing one `read_notes` row that links back
 * to it. The kind follows the item: a `page` is a `mark`, or a `note` when it has text; a
 * `range` is a `highlight` with its quote (cut by `shareQuote`) and its note, if any.
 *
 * Idempotent: a second share of the same item to the same read returns the existing row
 * (the unique index on (annotation_id, read_id) reports the conflict). Validation runs
 * before anything is sent.
 */
export async function shareAnnotation(
  input: ShareAnnotationInput,
  client?: SupabaseClient,
): Promise<ShareAnnotationResult> {
  const supabase = resolveClient(client);
  const { annotation } = input;

  const trimmedNote = typeof annotation.note === "string" ? annotation.note.trim() : "";
  const note = trimmedNote === "" ? null : trimmedNote;
  if (note !== null && Array.from(note).length > NOTE_MAX) {
    throw new Error(`A note must be 1 to ${NOTE_MAX} characters.`);
  }

  let kind: ReadNoteKind;
  let quote: ShareQuote | null = null;
  if (annotation.kind === "range") {
    const text = annotation.quote ?? "";
    if (text === "") throw new Error("A highlight needs quoted text to share.");
    kind = "highlight";
    quote = shareQuote(text, input.prefix ?? "", input.suffix ?? "");
  } else {
    kind = note === null ? "mark" : "note";
  }

  const position = clampPosition(input.position);
  const truncated = quote?.truncated ?? false;

  const { data, error } = await supabase
    .from("read_notes")
    .insert({
      annotation_id: annotation.id,
      read_id: input.readId,
      user_id: input.userId,
      chapter_index: position.chapterIndex,
      chapter_fraction: position.chapterFraction,
      kind,
      note,
      quote_exact: quote?.quote_exact ?? null,
      quote_prefix: quote?.quote_prefix ?? null,
      quote_suffix: quote?.quote_suffix ?? null,
      cfi: annotation.cfi,
      content_sha256: input.contentSha256 ?? null,
    })
    .select("id")
    .single();

  if (!error) return { id: (data as { id: string }).id, truncated };
  if (error.code !== UNIQUE_VIOLATION) throw error;

  // Already shared to this read: return the existing copy.
  const existing = await supabase
    .from("read_notes")
    .select("id")
    .eq("annotation_id", annotation.id)
    .eq("read_id", input.readId)
    .single();
  if (existing.error) throw existing.error;
  return { id: (existing.data as { id: string }).id, truncated };
}

/** Remove the group copy of a personal item from one read. RLS allows the owner only. */
export async function unshareAnnotation(
  annotationId: string,
  readId: string,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = resolveClient(client);
  const { error } = await supabase
    .from("read_notes")
    .delete()
    .eq("annotation_id", annotationId)
    .eq("read_id", readId);
  if (error) throw error;
}

/**
 * The caller's `read_notes` rows that link to this personal item (one per read it is
 * shared to). Direct select is owner-only, so this returns only my own copies.
 */
export async function listSharedReads(
  annotationId: string,
  client?: SupabaseClient,
): Promise<ReadNote[]> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("read_notes")
    .select("*")
    .eq("annotation_id", annotationId);
  if (error) throw error;
  return (data as ReadNote[] | null) ?? [];
}

/**
 * Group notes by outline chapter index. Within a chapter the input order is kept, so
 * pass notes in the order `listVisibleNotes` returned them (position order).
 */
export function notesByChapter<T extends { chapter_index: number }>(
  notes: readonly T[],
): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const note of notes) {
    const bucket = out.get(note.chapter_index);
    if (bucket) bucket.push(note);
    else out.set(note.chapter_index, [note]);
  }
  return out;
}
