// Shared book-ingest pipeline (SPEC §6, M2).
//
// Both entry points call this:
//   - POST /api/import          (Standard Ebooks / Gutenberg — Agent A)
//   - the DRM-checked upload flow (Agent B)
//
// Steps: validate EPUB structure -> DRM check (throw DrmProtectedError if not
// clean) -> fill in title/author from EPUB metadata if absent -> upload to
// Storage -> insert the `books` row -> return it. On a DB failure after upload,
// the just-uploaded file is removed so we don't leak orphaned objects.

import { createClient } from "@/lib/supabase/server";
import type { Book, BookSource } from "@/lib/types";
import { assertValidEpub, InvalidEpubError } from "@/lib/epub/validate";
import { checkDrm } from "@/lib/epub/drm";
import { extractEpubMetadata } from "@/lib/epub/metadata";
import { extractEpubCover } from "@/lib/epub/cover";
import { uploadBookFile, uploadCoverFile, deleteBookFile } from "@/lib/storage";

export { InvalidEpubError };

/**
 * Pull the cover out of the EPUB and store it beside the book.
 *
 * Best-effort by design: plenty of EPUBs carry no cover, and a book with no
 * picture is a complete book. Never throws — the shelf falls back to the title
 * initial exactly as before.
 */
async function storeCover(
  userId: string,
  bookId: string,
  bytes: ArrayBuffer | Uint8Array,
): Promise<string | null> {
  try {
    const cover = await extractEpubCover(bytes);
    if (!cover) return null;
    return await uploadCoverFile(
      userId,
      bookId,
      cover.bytes,
      cover.mediaType,
      cover.extension,
    );
  } catch {
    return null;
  }
}

const DRM_USER_MESSAGE =
  "This EPUB is DRM-protected and can't be added. Leaf only supports DRM-free books.";

/**
 * Thrown by {@link ingestEpub} when the EPUB carries DRM (SPEC §3.5).
 * `message` is safe to show to the user; `reason` is the technical detail.
 */
export class DrmProtectedError extends Error {
  /** Alias of `message` — the user-facing copy. */
  readonly userMessage: string;
  /** Short technical detail from the DRM check (not for display). */
  readonly reason?: string;

  constructor(reason?: string) {
    super(DRM_USER_MESSAGE);
    this.name = "DrmProtectedError";
    this.userMessage = DRM_USER_MESSAGE;
    this.reason = reason;
  }
}

export interface IngestEpubParams {
  userId: string;
  /** `"standardebooks"` | `"gutenberg"` for imports, `"upload"` for uploads. */
  source: BookSource;
  /** SE slug / Gutenberg id for imports; `null` for uploads. */
  sourceRef: string | null;
  bytes: ArrayBuffer | Uint8Array;
  /** Catalog-supplied title; extracted from the EPUB when omitted. */
  title?: string;
  /** Catalog-supplied author; extracted from the EPUB when omitted. */
  author?: string;
}

export async function ingestEpub(params: IngestEpubParams): Promise<Book> {
  const { userId, source, sourceRef, bytes } = params;

  // 1. Structure.
  await assertValidEpub(bytes);

  // 2. DRM (hard gate).
  const drm = await checkDrm(bytes);
  if (!drm.drmFree) {
    throw new DrmProtectedError(drm.reason);
  }

  // 3. Metadata — only parse the EPUB if we're missing something.
  let title = params.title?.trim() ?? "";
  let author = params.author?.trim() ?? "";
  if (!title || !author) {
    const meta = await extractEpubMetadata(bytes);
    if (!title) title = meta.title;
    if (!author) author = meta.author;
  }
  if (!title) title = "Untitled";

  // 4. Upload. Generate the id up front so the storage key is deterministic.
  const bookId = crypto.randomUUID();
  const storagePath = await uploadBookFile(userId, bookId, bytes);
  const coverPath = await storeCover(userId, bookId, bytes);

  // 5. Insert the row; roll the file back if that fails.
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("books")
      .insert({
        id: bookId,
        user_id: userId,
        title,
        author,
        source,
        source_ref: sourceRef,
        storage_path: storagePath,
        cover_path: coverPath,
        cover_url: null,
        status: "reading",
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as Book;
  } catch (err) {
    await deleteBookFile(storagePath).catch(() => {
      /* best-effort cleanup */
    });
    throw err;
  }
}

export interface RegisterUploadedEpubParams {
  userId: string;
  /** Existing Storage key: `${userId}/${bookId}.epub` (already uploaded). */
  storagePath: string;
  /** The object's bytes (download them once, pass them here). */
  bytes: ArrayBuffer | Uint8Array;
  title?: string;
  author?: string;
}

/**
 * Upload-flow variant for Agent B: the browser has already put the EPUB in
 * Storage via a signed URL, so this validates + DRM-checks + reads metadata +
 * inserts the `books` row **without re-uploading**. `source` is always
 * `"upload"`, `source_ref` always `null`. The `bookId` is taken from the
 * storage path (`${userId}/${bookId}.epub`).
 *
 * On DRM / invalid EPUB it throws (like {@link ingestEpub}) but does NOT delete
 * the object — the caller owns rollback of a file it uploaded.
 */
export async function registerUploadedEpub(
  params: RegisterUploadedEpubParams,
): Promise<Book> {
  const { userId, storagePath, bytes } = params;

  const prefix = `${userId}/`;
  if (!storagePath.startsWith(prefix) || !storagePath.endsWith(".epub")) {
    throw new InvalidEpubError(`Storage path "${storagePath}" is not the caller's`);
  }
  const bookId = storagePath.slice(prefix.length, -".epub".length);

  await assertValidEpub(bytes);
  const drm = await checkDrm(bytes);
  if (!drm.drmFree) throw new DrmProtectedError(drm.reason);

  let title = params.title?.trim() ?? "";
  let author = params.author?.trim() ?? "";
  if (!title || !author) {
    const meta = await extractEpubMetadata(bytes);
    if (!title) title = meta.title;
    if (!author) author = meta.author;
  }
  if (!title) title = "Untitled";

  const coverPath = await storeCover(userId, bookId, bytes);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("books")
    .insert({
      id: bookId,
      user_id: userId,
      title,
      author,
      source: "upload",
      source_ref: null,
      storage_path: storagePath,
      cover_path: coverPath,
      cover_url: null,
      status: "reading",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Book;
}
