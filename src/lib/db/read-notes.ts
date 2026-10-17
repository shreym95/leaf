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
import type { ReadNote, ReadNoteKind, VisibleReadNote } from "@/lib/types";

/** Longest note, in characters (code points, as Postgres counts them). */
export const NOTE_MAX = 500;

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
  const chapterIndex = Number.isFinite(input.position.chapterIndex)
    ? Math.max(0, Math.trunc(input.position.chapterIndex))
    : 0;

  const { data, error } = await supabase
    .from("read_notes")
    .insert({
      read_id: input.readId,
      user_id: input.userId,
      chapter_index: chapterIndex,
      chapter_fraction: clamp01(input.position.chapterFraction),
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
