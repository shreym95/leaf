/**
 * Normalizer — heading extraction.
 *
 * Ported from the Python prototype (`reference/normalizer.py`). This module
 * holds the *decision* logic only: given a parsed chapter, work out whether it
 * has an ordinal ("Chapter V", "I"), a title ("The Cyclone"), both, or
 * neither. It is pure, DOM-standard, and needs no epub.js — so it can run at
 * import time or inside a render hook.
 *
 * Tiered degradation is the contract (SPEC §7): rich treatment when the markup
 * is clean, safe fallback when it is messy, never a crash. This function never
 * invents a title.
 */

/** epub: namespace URI. Standard Ebooks declares `xmlns:epub` on <html>. */
const EPUB_NS = "http://www.idpf.org/2007/ops";

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/** "Chapter V", "Part I", "Book Two", "Letter 4" → ordinal, not a title. */
const ORDINAL_PREFIX = /^(chapter|part|book|letter)\b/i;
/** Bare roman numeral, e.g. "IV". Case-sensitive, matching the Python. */
const ROMAN_NUMERAL = /^[IVXLC]+$/;

export interface ChapterHeading {
  /** e.g. "Chapter V", "I". Null when no ordinal was found. */
  ordinal: string | null;
  /** e.g. "The Cyclone". Null when there is no real title (never invented). */
  title: string | null;
  /** Convenience: `title !== null`. */
  hasTitle: boolean;
}

/** Collapse runs of whitespace and trim; return null for an empty result. */
function cleanText(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

/** Read a (possibly namespaced) `epub:type` value off an element. */
function epubType(el: Element): string {
  return el.getAttributeNS(EPUB_NS, "type") ?? el.getAttribute("epub:type") ?? "";
}

/**
 * Locate the chapter wrapper: first <section> or <article>, else <body>, else
 * the root itself. Mirrors `soup.find(['section','article']) or soup.find('body')
 * or soup`.
 */
function findWrapper(root: Document | Element): Document | Element {
  const isDocument = root.nodeType === 9;

  if (!isDocument) {
    const self = root as Element;
    if (typeof self.matches === "function" && self.matches("section, article")) {
      return self;
    }
  }

  const scope = root as ParentNode;
  return (
    scope.querySelector("section, article") ??
    scope.querySelector("body") ??
    (isDocument ? ((root as Document).documentElement ?? root) : root)
  );
}

/**
 * Extract heading info from a parsed chapter.
 *
 * Tier 1 — an <hgroup> is present: its first heading is the ordinal; the
 *   descendant whose `epub:type` contains "title" (else its first <p>) is the
 *   title.
 * Tier 2 — no <hgroup>: take the wrapper's first heading. If its text looks
 *   like an ordinal ("Chapter …" / roman numeral) it is the ordinal with no
 *   title; otherwise it is the title with no ordinal.
 * Tier 3 — nothing usable: both null (the caller decides how to render a
 *   fallback; the prototype emits "§").
 *
 * @param root - a parsed chapter, as a `Document` or the wrapper `Element`.
 */
export function extractChapterHeading(root: Document | Element): ChapterHeading {
  const wrapper = findWrapper(root);

  let ordinal: string | null = null;
  let title: string | null = null;

  const hgroup = wrapper.querySelector("hgroup");

  if (hgroup) {
    const heading = hgroup.querySelector(HEADING_SELECTOR);
    if (heading) ordinal = cleanText(heading.textContent);

    const titleEl =
      Array.from(hgroup.querySelectorAll("*")).find((el) =>
        epubType(el).includes("title"),
      ) ?? hgroup.querySelector("p");
    if (titleEl) title = cleanText(titleEl.textContent);
  } else {
    const heading = wrapper.querySelector(HEADING_SELECTOR);
    if (heading) {
      const raw = cleanText(heading.textContent);
      if (raw) {
        if (ORDINAL_PREFIX.test(raw) || ROMAN_NUMERAL.test(raw)) {
          ordinal = raw;
        } else {
          title = raw;
        }
      }
    }
  }

  return { ordinal, title, hasTitle: title !== null };
}

/**
 * Convenience wrapper for tests / import-time processing: parse an XHTML string
 * and extract its heading. Standard Ebooks / Gutenberg chapters are XHTML, so
 * this parses as XML to keep the namespaced `epub:type` attributes intact.
 */
export function extractChapterHeadingFromXhtml(xhtml: string): ChapterHeading {
  const doc = new DOMParser().parseFromString(xhtml, "application/xml");
  return extractChapterHeading(doc);
}

// ---------------------------------------------------------------------------
// M3: runs as an epub.js rendition.hooks.content handler over each rendered
// chapter DOM. Rewrites the wrapper to <article class="chapter"> with
// <header>, ordinal eyebrow, Fraunces title, first-paragraph drop-cap/lede,
// strips publisher CSS, injects our stylesheet. Not implemented in M0.
// ---------------------------------------------------------------------------
export function normalizeChapterDom(
  _doc: Document,
  _meta: { bookTitle: string; author: string; index: number; total: number },
): void {
  throw new Error("normalizeChapterDom: not implemented until M3");
}
