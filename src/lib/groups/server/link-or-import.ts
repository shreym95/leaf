// Giving a member their own copy of a group read.
//
// Files never cross users (FEATURES_PLAN 5.2): a member's copy is always their
// own book. For a catalog read the member either already has that book (same
// source + source_ref, not archived), which is linked, or it is imported into
// their library through the shared ingest pipeline.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestEpub } from "@/lib/books/ingest";
import { fetchStandardEbooksEpub } from "@/lib/import/standard-ebooks";
import { fetchGutenbergEpub } from "@/lib/import/gutendex";
import type { CatalogSource } from "@/lib/import/types";

export const CATALOG_SOURCES: readonly CatalogSource[] = [
  "standardebooks",
  "gutenberg",
];

export function isCatalogSource(value: unknown): value is CatalogSource {
  return (
    typeof value === "string" &&
    (CATALOG_SOURCES as readonly string[]).includes(value)
  );
}

export interface CatalogRead {
  id: string;
  title: string;
  source: CatalogSource;
  source_ref: string;
}

export interface CopyDetails {
  contentSha256?: string | null;
  alignment?: unknown | null;
}

/** The member's oldest non-archived book with this source + source_ref. */
export async function findOwnBook(
  admin: SupabaseClient,
  userId: string,
  source: CatalogSource,
  sourceRef: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("books")
    .select("id")
    .eq("user_id", userId)
    .eq("source", source)
    .eq("source_ref", sourceRef)
    .is("archived_at", null)
    .order("added_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  const row = (data as Array<{ id: string }> | null)?.[0];
  return row?.id ?? null;
}

/** Link a book to a read for a member. An existing link is left as it is. */
export async function linkCopy(
  admin: SupabaseClient,
  readId: string,
  userId: string,
  bookId: string,
  details: CopyDetails = {},
): Promise<void> {
  const { error } = await admin.from("read_copies").upsert(
    {
      read_id: readId,
      user_id: userId,
      book_id: bookId,
      content_sha256: details.contentSha256 ?? null,
      alignment: details.alignment ?? null,
    },
    { onConflict: "read_id,user_id", ignoreDuplicates: true },
  );
  if (error) throw error;
}

/** Download a catalog EPUB and ingest it into the signed-in user's library. */
export async function importCatalogBook(
  userId: string,
  source: CatalogSource,
  sourceRef: string,
): Promise<string> {
  const bytes =
    source === "standardebooks"
      ? await fetchStandardEbooksEpub(sourceRef)
      : await fetchGutenbergEpub(sourceRef);
  const book = await ingestEpub({ userId, source, sourceRef, bytes });
  return book.id;
}

export interface LinkOrImportResult {
  linked: number;
  imported: number;
  /** Reads that could not be completed; the member can add the copy later. */
  failed: Array<{ readId: string; title: string }>;
}

/**
 * For each catalog read, link the member's existing book or import it.
 *
 * Imports run through `ingestEpub`, which writes with the signed-in user's
 * session, so `userId` must be the caller. One read failing never stops the
 * others.
 */
export async function linkOrImportCatalogReads(
  admin: SupabaseClient,
  userId: string,
  reads: readonly CatalogRead[],
): Promise<LinkOrImportResult> {
  const result: LinkOrImportResult = { linked: 0, imported: 0, failed: [] };
  for (const read of reads) {
    try {
      const existing = await findOwnBook(
        admin,
        userId,
        read.source,
        read.source_ref,
      );
      if (existing) {
        await linkCopy(admin, read.id, userId, existing);
        result.linked += 1;
      } else {
        const bookId = await importCatalogBook(
          userId,
          read.source,
          read.source_ref,
        );
        await linkCopy(admin, read.id, userId, bookId);
        result.imported += 1;
      }
    } catch (err) {
      console.error("[groups] catalog copy failed", {
        readId: read.id,
        err: err instanceof Error ? err.message : String(err),
      });
      result.failed.push({ readId: read.id, title: read.title });
    }
  }
  return result;
}

/**
 * Link members who already own the book. Used when a read is added: another
 * member's import cannot be written with the caller's session, so members
 * without the book get no copy yet and are counted as `pending`.
 */
export async function linkExistingCopies(
  admin: SupabaseClient,
  read: CatalogRead,
  groupId: string,
  exceptUserId: string,
): Promise<{ linked: number; pending: number }> {
  const { data: members, error } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId);
  if (error) throw error;

  let linked = 0;
  let pending = 0;
  for (const m of (members as Array<{ user_id: string }> | null) ?? []) {
    if (m.user_id === exceptUserId) continue;
    try {
      const existing = await findOwnBook(
        admin,
        m.user_id,
        read.source,
        read.source_ref,
      );
      if (existing) {
        await linkCopy(admin, read.id, m.user_id, existing);
        linked += 1;
      } else {
        pending += 1;
      }
    } catch (err) {
      console.error("[groups] linking existing copy failed", {
        readId: read.id,
        err: err instanceof Error ? err.message : String(err),
      });
      pending += 1;
    }
  }
  return { linked, pending };
}
