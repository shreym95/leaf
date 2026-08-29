// Shared types for the book-import layer (SPEC §6, M2).
// Style-agnostic: no design/component imports (ESLint seam, CLAUDE.md).

/**
 * Catalog sources Leaf can *import* from. A superset value `"upload"` also
 * exists on {@link import("@/lib/types").BookSource} for user uploads, but that
 * path never goes through a catalog search, so it is intentionally excluded
 * here.
 */
export type CatalogSource = "standardebooks" | "gutenberg";

/** One hit from a catalog search — the client shows these and imports by `ref`. */
export interface SearchResult {
  source: CatalogSource;
  /**
   * Stable per-source identifier passed back to `POST /api/import`:
   * - `standardebooks`: the ebook slug, e.g. `"mary-shelley/frankenstein"`
   *   (the path after `https://standardebooks.org/ebooks/`).
   * - `gutenberg`: the Project Gutenberg / Gutendex numeric id as a string,
   *   e.g. `"84"`.
   */
  ref: string;
  title: string;
  author: string;
  coverUrl?: string;
}

/** Descriptive UA — some hosts (incl. Standard Ebooks) block default agents. */
export const IMPORT_USER_AGENT = "Leaf/0.1 (+book importer)";

/** `"Shelley, Mary Wollstonecraft"` -> `"Mary Wollstonecraft Shelley"`. */
export function normalizeAuthorName(name: string): string {
  const trimmed = name.trim();
  const comma = trimmed.indexOf(", ");
  if (comma === -1) return trimmed;
  const last = trimmed.slice(0, comma).trim();
  const rest = trimmed.slice(comma + 2).trim();
  if (!last || !rest) return trimmed;
  return `${rest} ${last}`;
}
