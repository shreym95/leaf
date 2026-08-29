// EPUB metadata extraction (SPEC §6): META-INF/container.xml -> OPF ->
// dc:title / dc:creator. Used when an import/upload has no catalog-supplied
// title/author. Style-agnostic logic layer.

import { loadEpubZip, readOpf, type EpubBytes } from "./validate";

export interface EpubMetadata {
  title: string;
  author: string;
}

/**
 * Parse the EPUB package document for its title and author(s). Missing fields
 * degrade gracefully: `title` falls back to `"Untitled"`, `author` to `""`
 * (the `books.author` column defaults to `''`). Multiple `dc:creator` entries
 * are joined with `", "`.
 */
export async function extractEpubMetadata(
  bytes: EpubBytes,
): Promise<EpubMetadata> {
  const zip = await loadEpubZip(bytes);
  const opf = await readOpf(zip);
  return {
    title: opf.title.trim() || "Untitled",
    author: opf.creators.join(", "),
  };
}
