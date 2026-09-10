// Shared EPUB-navigation (TOC) lookup. LOGIC ONLY, same as everything else in
// `src/reader`.
//
// Split out of `./engine` so `./content-hook` can reuse the exact same
// lookup — a chapter whose own markup has no usable heading (an image-only
// `<h1>`, say) falls back to the label the EPUB's own nav document gives that
// section — without either module reaching into the other's internals. Both
// live in `src/reader`, so this is a same-layer split, not a new seam.

/** One entry of the book's own table of contents, flattened for the chrome. */
export interface ReaderTocEntry {
  /** Spine href (may carry a fragment) — pass straight to `goTo()`. */
  href: string;
  /** Display label from the EPUB navigation document, trimmed. */
  label: string;
}

/** The slice of epub.js's `Book` this module actually reads — matches how
 *  `book.navigation` is reached elsewhere in `src/reader` (see `bookMeta()` in
 *  `./content-hook`, which reaches `book.packaging` the same defensive way). */
export interface NavigationBookLike {
  navigation?: { toc?: unknown };
}

type NavItemish = { href?: string; label?: string; subitems?: unknown[] };

/** Strip a fragment and a leading `./` so hrefs from different sources compare
 *  equal (a spine href vs. a nav-doc href for the same file). */
function bareHref(href: string): string {
  return href.split("#")[0].replace(/^\.?\//, "");
}

/**
 * Walk the EPUB's own TOC for the entry whose href matches `href` (fragments
 * and a leading `./` stripped from both sides) and return its label.
 * Best-effort: a book with no navigation document, or no matching entry,
 * returns `undefined` rather than throwing.
 */
export function chapterLabelForHref(
  book: NavigationBookLike | undefined,
  href: string | undefined,
): string | undefined {
  if (!href) return undefined;
  try {
    const toc = book?.navigation?.toc;
    if (!Array.isArray(toc) || toc.length === 0) return undefined;
    const want = bareHref(href);
    const walk = (items: NavItemish[]): string | undefined => {
      for (const it of items) {
        if (typeof it?.href === "string" && bareHref(it.href) === want) {
          const label = typeof it.label === "string" ? it.label.trim() : "";
          if (label) return label;
        }
        const sub = Array.isArray(it?.subitems)
          ? (it.subitems as NavItemish[])
          : undefined;
        if (sub) {
          const nested = walk(sub);
          if (nested) return nested;
        }
      }
      return undefined;
    };
    return walk(toc as NavItemish[]);
  } catch {
    return undefined;
  }
}

/**
 * Flatten the EPUB's navigation document to a plain list, depth-first, so a
 * caller can render a chapter menu without knowing epub.js's nested shape.
 * Same tolerance as `chapterLabelForHref`: an item missing either an href or a
 * label is skipped rather than rendered blank.
 */
export function flattenToc(
  book: NavigationBookLike | undefined,
): ReaderTocEntry[] {
  try {
    const toc = book?.navigation?.toc;
    if (!Array.isArray(toc) || toc.length === 0) return [];
    const out: ReaderTocEntry[] = [];
    const walk = (items: NavItemish[]): void => {
      for (const it of items) {
        const href = typeof it?.href === "string" ? it.href.trim() : "";
        const label = typeof it?.label === "string" ? it.label.trim() : "";
        if (href && label) out.push({ href, label });
        const sub = Array.isArray(it?.subitems)
          ? (it.subitems as NavItemish[])
          : undefined;
        if (sub) walk(sub);
      }
    };
    walk(toc as NavItemish[]);
    return out;
  } catch {
    return [];
  }
}
