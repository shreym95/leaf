// "Get my copy": give the caller their own copy of a group read.
//
// With a `bookId` the caller picks one of their own books. Without one, a
// catalog read links the caller's existing non-archived copy (same source +
// source_ref) or imports it. The copy is then aligned with the read's outline.
// Repeating the call is safe: a copy already linked to the same book is only
// aligned again when it has no alignment yet.

import type { SupabaseClient } from "@supabase/supabase-js";
import { alignMemberCopy } from "./copy-alignment";
import {
  findOwnBook,
  importCatalogBook,
  isCatalogSource,
  linkCopy,
  updateCopy,
} from "./link-or-import";

export interface MyCopyResult {
  linked: boolean;
  imported: boolean;
  /** Null when the book's contents could not be read; the copy is still linked. */
  alignment: { confidence: number } | null;
}

export type MyCopyOutcome =
  | ({ ok: true } & MyCopyResult)
  | { ok: false; status: number; message: string };

interface ReadRow {
  id: string;
  source: string;
  source_ref: string | null;
  outline: unknown;
}

interface CopyRow {
  book_id: string;
  alignment: unknown;
}

function confidenceOf(alignment: unknown): number | null {
  if (!alignment || typeof alignment !== "object") return null;
  const c = (alignment as { confidence?: unknown }).confidence;
  return typeof c === "number" && Number.isFinite(c) ? c : null;
}

/** `bookId` must already be a valid uuid when given. The caller is a member of the read's group. */
export async function getMyCopy(
  admin: SupabaseClient,
  userId: string,
  groupId: string,
  readId: string,
  bookId: string | null,
): Promise<MyCopyOutcome> {
  const { data: readRow, error: readError } = await admin
    .from("group_reads")
    .select("id, source, source_ref, outline")
    .eq("id", readId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (readError) throw readError;
  const read = readRow as ReadRow | null;
  if (!read) return { ok: false, status: 404, message: "Read not found." };

  const { data: copyRow, error: copyError } = await admin
    .from("read_copies")
    .select("book_id, alignment")
    .eq("read_id", readId)
    .eq("user_id", userId)
    .maybeSingle();
  if (copyError) throw copyError;
  const current = copyRow as CopyRow | null;

  let targetId = bookId;
  let imported = false;

  if (targetId) {
    const { data, error } = await admin
      .from("books")
      .select("id")
      .eq("id", targetId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, status: 404, message: "Book not found." };
  } else if (current) {
    targetId = current.book_id;
  } else {
    if (!isCatalogSource(read.source) || !read.source_ref) {
      return { ok: false, status: 400, message: "Choose a book." };
    }
    targetId = await findOwnBook(admin, userId, read.source, read.source_ref);
    if (!targetId) {
      try {
        targetId = await importCatalogBook(userId, read.source, read.source_ref);
        imported = true;
      } catch (err) {
        console.error("[groups] importing a copy failed", {
          readId,
          err: err instanceof Error ? err.message : String(err),
        });
        return { ok: false, status: 502, message: "Could not get the book. Try again." };
      }
    }
  }

  // Already linked to this book: only fill in a missing alignment.
  if (current && current.book_id === targetId) {
    const have = confidenceOf(current.alignment);
    if (have !== null) {
      return { ok: true, linked: true, imported, alignment: { confidence: have } };
    }
    const aligned = await alignMemberCopy(admin, userId, targetId, read.outline);
    if (aligned.alignment) {
      await updateCopy(admin, readId, userId, {
        contentSha256: aligned.contentSha256,
        alignment: aligned.alignment,
      });
    }
    return {
      ok: true,
      linked: true,
      imported,
      alignment: aligned.alignment
        ? { confidence: aligned.alignment.confidence }
        : null,
    };
  }

  const aligned = await alignMemberCopy(admin, userId, targetId, read.outline);
  if (current) {
    // A different book than the one linked: the caller chose it, so it replaces the link.
    await updateCopy(admin, readId, userId, {
      bookId: targetId,
      contentSha256: aligned.contentSha256,
      alignment: aligned.alignment,
    });
  } else {
    await linkCopy(admin, readId, userId, targetId, aligned);
  }
  return {
    ok: true,
    linked: true,
    imported,
    alignment: aligned.alignment
      ? { confidence: aligned.alignment.confidence }
      : null,
  };
}
