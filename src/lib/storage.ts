// Supabase Storage helpers for EPUB files (SPEC §2, §3.3, §6). Server-only.
//
// Bucket: `epubs` (private, created in 0001_init.sql).
// Object key convention (MUST match the bucket RLS policy): `${userId}/${bookId}.epub`
// — the first path segment is the owner, checked against `auth.uid()`.
//
// These call the request-scoped server client, so every operation runs as the
// signed-in user and is enforced by Storage RLS (not the explicit userId args,
// which are belt-and-braces / path construction).

import { createClient } from "@/lib/supabase/server";
import { IS_DEMO } from "@/lib/demo/flag";
import { demoBookFileUrl } from "@/lib/demo/fixtures";

const BUCKET = "epubs";
const EPUB_CONTENT_TYPE = "application/epub+zip";

/** The canonical object key for a user's book file. */
export function bookStoragePath(userId: string, bookId: string): string {
  return `${userId}/${bookId}.epub`;
}

/** The canonical object key for a book's cover — same folder, so same RLS. */
export function coverStoragePath(
  userId: string,
  bookId: string,
  extension: string,
): string {
  return `${userId}/${bookId}-cover.${extension}`;
}

function assertOwnedPath(userId: string, storagePath: string): void {
  if (storagePath.split("/")[0] !== userId) {
    throw new Error(
      `Storage path "${storagePath}" is not owned by user "${userId}"`,
    );
  }
}

function toUint8Array(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/**
 * Upload (or overwrite) a book's EPUB. Returns the storage path to persist on
 * the `books` row.
 */
export async function uploadBookFile(
  userId: string,
  bookId: string,
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  const supabase = await createClient();
  const path = bookStoragePath(userId, bookId);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, toUint8Array(bytes), {
      contentType: EPUB_CONTENT_TYPE,
      upsert: true,
    });
  if (error) throw error;
  return path;
}

/** A short-lived signed GET URL for a stored EPUB (default 1 hour). */
export async function signBookUrl(
  userId: string,
  storagePath: string,
  expiresSec = 3600,
): Promise<string> {
  // Demo mode: the bundled EPUBs are served straight from `/public/bundled/`.
  if (IS_DEMO) return demoBookFileUrl(storagePath);

  assertOwnedPath(userId, storagePath);
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresSec);
  if (error) throw error;
  if (!data?.signedUrl) {
    throw new Error(`Failed to sign URL for "${storagePath}"`);
  }
  return data.signedUrl;
}

/** Delete a stored EPUB. Used for rollback on a failed ingest and account cleanup. */
export async function deleteBookFile(storagePath: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw error;
}

/**
 * Upload (or overwrite) a book's cover image. Returns the storage path.
 */
export async function uploadCoverFile(
  userId: string,
  bookId: string,
  bytes: ArrayBuffer | Uint8Array,
  mediaType: string,
  extension: string,
): Promise<string> {
  const supabase = await createClient();
  const path = coverStoragePath(userId, bookId, extension);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, toUint8Array(bytes), {
      contentType: mediaType,
      upsert: true,
    });
  if (error) throw error;
  return path;
}

/**
 * Sign several cover paths in one call.
 *
 * The shelf renders every book at once, so signing them individually would be
 * one network round trip per book — the same mistake the auth layer made before
 * M5. Returns a path -> URL map; a path that fails to sign is simply absent, and
 * the card falls back to its title initial.
 */
export async function signCoverUrls(
  paths: string[],
  expiresSec = 3600,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(paths.filter(Boolean))];
  if (wanted.length === 0) return out;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(wanted, expiresSec);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
    }
  } catch {
    // A cover is decoration — never let signing failures break the shelf.
  }
  return out;
}
