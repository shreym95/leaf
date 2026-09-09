// Shared by the dock and the return chip — both name a chapter to the reader.

/**
 * EPUB tables of contents are free text: some books name their chapters, others
 * (Calibre exports especially) give a bare ordinal. A lone "4" sitting in the
 * dock reads as a hanging number with no referent, so ordinals — arabic or
 * roman — get a "Ch." in front. A real title is left exactly as the book wrote
 * it; prefixing "Chapter" onto "The Creation" would be inventing structure.
 */
export function formatChapterLabel(label: string | null): string | null {
  if (label == null) return null;
  const trimmed = label.trim();
  if (!trimmed) return null;
  return /^(\d{1,4}|[ivxlcdm]{1,7})$/i.test(trimmed) ? `Ch. ${trimmed}` : trimmed;
}
