// Table of contents of a stored EPUB, read server-side.
//
// OPEN: `src/lib/epub/*` has no navigation parser (it reads the OPF manifest
// only), and writing one is outside the groups route task. `extractEpubToc`
// is the single seam to fill: it must return the EPUB 3 nav / EPUB 2 NCX as a
// `TocInput[]` (href, label, subitems), in document order. Until it exists,
// adding a group read answers 501.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TocInput } from "@/lib/groups/types";

const BUCKET = "epubs";

export class TocUnavailableError extends Error {
  constructor() {
    super("No EPUB table-of-contents parser is available.");
    this.name = "TocUnavailableError";
  }
}

export async function extractEpubToc(
  _bytes: ArrayBuffer | Uint8Array,
): Promise<TocInput[]> {
  throw new TocUnavailableError();
}

/** Download a book's EPUB with the service role. The caller has already checked ownership. */
export async function downloadBookBytes(
  admin: SupabaseClient,
  storagePath: string,
): Promise<ArrayBuffer> {
  const { data, error } = await admin.storage.from(BUCKET).download(storagePath);
  if (error) throw error;
  if (!data) throw new Error("Empty download.");
  return data.arrayBuffer();
}
