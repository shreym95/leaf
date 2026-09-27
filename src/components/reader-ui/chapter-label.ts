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

/**
 * How many characters of an already-`formatChapterLabel`'d string the jump
 * chips (`ReturnChip` / `SyncOfferChip`) will show before shortening it.
 * "Ch. N" is always well under this; it only ever bites a real book title.
 * Sized so `"Continue at " + label` (the longer of the two verb prefixes)
 * still fits comfortably in the chip's own responsive width on a 360px
 * phone (see `JumpChip`) well before CSS `truncate` would ever need to cut
 * mid-word.
 */
const JUMP_LABEL_MAX = 28;

/**
 * Shortens an ALREADY-FORMATTED chapter label (i.e. `formatChapterLabel`'s
 * own output) for display in a jump chip — never applied to the raw TOC
 * string, and never to what a caller builds its `aria-label` from (that stays
 * the full, accurate label; see `ReturnChip`/`SyncOfferChip`).
 *
 * `formatChapterLabel` has no length limit — an author's chapter title is
 * whatever the book says, and the dock's own chapter display (which also
 * calls `formatChapterLabel` directly, not this) has the room and the
 * truncation for that. A jump chip does not: it is a small pill with a verb
 * ("Back to " / "Continue at ") already eating into its budget, and the
 * production defect this fixes (founder, 2026-09-28) was a chip whose label
 * was cut off with "…" and named no destination at all.
 *
 * Cuts at the last whole word within the budget — never mid-word — so a
 * shortened title still reads as words, not a garbled fragment.
 */
export function shortenForJumpChip(label: string | null): string | null {
  if (label == null || label.length <= JUMP_LABEL_MAX) return label;
  const cut = label.slice(0, JUMP_LABEL_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  const words = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${words.trimEnd()}…`;
}
