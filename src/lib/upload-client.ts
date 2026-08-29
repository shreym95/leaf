// Client helper for the DRM-free EPUB upload flow (SPEC §3.5, §6).
//
// The file goes DIRECT to Supabase Storage via a signed upload URL — it never
// passes through a Route Handler, because Vercel caps serverless request bodies
// at 4.5MB and illustrated EPUBs exceed that. Flow:
//
//   1. reject non-.epub early (extension + mime)
//   2. POST /api/upload/sign            -> { path, token, bookId }
//   3. storage.uploadToSignedUrl(...)   -> bytes land in the `epubs` bucket
//   4. POST /api/books/register { path }-> server validates + DRM-checks +
//                                          inserts the `books` row
//
// Only the browser Supabase client (anon key) is used here — no service role,
// no secrets. Server errors (401, 422 DRM/invalid, …) are surfaced verbatim so
// the caller can show them.

import { createClient } from "@/lib/supabase/client";
import type { Book } from "@/lib/types";

/** Thrown for every user-facing upload failure. `.message` is safe to display. */
export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export interface UploadEpubOptions {
  /**
   * Coarse progress callback: 0 → 10 (signed) → 80 (uploaded) → 100
   * (registered). The Storage SDK's `uploadToSignedUrl` exposes no byte-level
   * progress events, so this is stepwise rather than continuous.
   */
  onProgress?: (pct: number) => void;
}

const EPUB_EXTENSION = /\.epub$/i;

// Browsers are inconsistent about the MIME they attach to a picked `.epub`
// (some send the correct type, some `application/octet-stream`, some nothing).
// The extension is the real gate on the client; the server re-checks the bytes.
const ACCEPTED_MIME_TYPES = new Set([
  "application/epub+zip",
  "application/epub",
  "application/zip",
  "application/octet-stream",
  "",
]);

export async function uploadEpub(
  file: File,
  opts: UploadEpubOptions = {},
): Promise<Book> {
  const { onProgress } = opts;

  if (!EPUB_EXTENSION.test(file.name)) {
    throw new UploadError("Only .epub files can be uploaded.");
  }
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    throw new UploadError("That doesn't look like an EPUB file.");
  }

  onProgress?.(0);

  // 1. mint a signed upload URL (auth required, enforced server-side)
  const signRes = await fetch("/api/upload/sign", { method: "POST" });
  if (!signRes.ok) {
    throw new UploadError(
      await serverError(signRes, "Could not start the upload."),
    );
  }
  const { path, token } = (await signRes.json()) as {
    path: string;
    token: string;
    bookId: string;
  };

  onProgress?.(10);

  // 2. upload straight to Supabase Storage
  const supabase = createClient();
  const { error: uploadError } = await supabase.storage
    .from("epubs")
    .uploadToSignedUrl(path, token, file, {
      contentType: "application/epub+zip",
    });
  if (uploadError) {
    throw new UploadError(
      uploadError.message || "Upload failed. Please try again.",
    );
  }

  onProgress?.(80);

  // 3. validate + DRM-check + register the book row
  const registerRes = await fetch("/api/books/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!registerRes.ok) {
    // The server has already deleted the orphaned object on a 422 (SPEC §3.5).
    throw new UploadError(
      await serverError(registerRes, "Could not add that book."),
    );
  }
  const book = (await registerRes.json()) as Book;

  onProgress?.(100);
  return book;
}

/** Pull `{ error }` out of a failed JSON response, falling back to `fallback`. */
async function serverError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) {
      return body.error;
    }
  } catch {
    // non-JSON body — use the fallback
  }
  return fallback;
}
