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
// M3: runs as an epub.js `rendition.hooks.content` handler over each rendered
// chapter DOM (see `src/reader/content-hook.ts`). Ports the Python prototype's
// DOM rewrite: wrapper -> `<article class="chapter">` with a clean `<header>`
// (ordinal eyebrow + Fraunces title, tiered), first paragraph flagged for the
// drop cap / small-caps lede, publisher attributes reset. Pure: mutates the
// passed `Document` in place, touches DOM + strings only.
// ---------------------------------------------------------------------------

/** XHTML namespace — epub content is always XHTML/HTML, so mint nodes into it. */
const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** Per-tag attribute allow-list for the publisher reset (everything else on a
 *  paragraph + its inline descendants is stripped, mirroring the Python's
 *  `tag.attrs = {}`). `href` is kept so links keep working. */
const KEEP_ATTRS: Record<string, ReadonlySet<string>> = {
  a: new Set(["href"]),
};
const NO_ATTRS: ReadonlySet<string> = new Set();

/** Head-ish nodes that must never be swept into the article body. */
const NON_BODY_TAGS = new Set([
  "HEAD",
  "SCRIPT",
  "STYLE",
  "LINK",
  "META",
  "TITLE",
  "BASE",
]);

export interface NormalizeChapterMeta {
  bookTitle: string;
  author: string;
  index: number;
  total: number;
}

/** Reset publisher classes / inline styles / `epub:type` on `root` and every
 *  descendant, keeping only allow-listed attributes (see `KEEP_ATTRS`). */
function resetPublisherAttrs(root: Element): void {
  const scrub = (node: Element): void => {
    const keep = KEEP_ATTRS[node.tagName.toLowerCase()] ?? NO_ATTRS;
    for (const name of Array.from(node.getAttributeNames())) {
      if (!keep.has(name)) node.removeAttribute(name);
    }
  };
  scrub(root);
  root.querySelectorAll("*").forEach((el) => scrub(el));
}

/**
 * Rewrite a rendered chapter DOM to Leaf's clean structure, in place.
 *
 * Result (tiered — SPEC §7):
 *   <article class="chapter">
 *     <header class="chapter-head">
 *       <p class="chapter-ordinal">…</p>   (when there is an ordinal / fallback "§")
 *       <h1 class="chapter-title">…</h1>    (only when a real title exists)
 *     </header>
 *     <p class="para first">…</p>           (drop cap + small-caps lede target)
 *     <p class="para">…</p> …               (original body content, kept in order)
 *   </article>
 *
 * Idempotent-ish: a DOM that already carries `article.chapter > header.chapter-head`
 * is returned untouched (no double-wrap).
 *
 * @returns the `<article class="chapter">` element, or `undefined` when there was
 *   no element to operate on.
 */
export function normalizeChapterDom(
  doc: Document,
  _meta: NormalizeChapterMeta,
): HTMLElement | undefined {
  // Already normalized — hand back the existing article.
  const done = doc.querySelector("article.chapter > header.chapter-head");
  if (done?.parentElement) return done.parentElement;

  const wrapper = findWrapper(doc);
  if (wrapper.nodeType !== 1) return undefined;
  const el = wrapper as Element;

  const make = (tag: string): HTMLElement =>
    doc.createElementNS(XHTML_NS, tag) as HTMLElement;

  const { ordinal, title } = extractChapterHeading(el);

  // Drop the source heading structure (mirrors the Python's `decompose()`).
  const hgroup = el.querySelector("hgroup");
  if (hgroup) {
    hgroup.remove();
  } else {
    el.querySelector(HEADING_SELECTOR)?.remove();
  }

  // Build the clean header.
  const header = make("header");
  header.setAttribute("class", "chapter-head");

  const addOrdinal = (text: string): void => {
    const p = make("p");
    p.setAttribute("class", "chapter-ordinal");
    p.textContent = text;
    header.appendChild(p);
  };

  if (ordinal) addOrdinal(ordinal);
  if (title) {
    const h1 = make("h1");
    h1.setAttribute("class", "chapter-title");
    h1.textContent = title;
    header.appendChild(h1);
  }
  if (!ordinal && !title) addOrdinal("§"); // graceful fallback

  // Classify + de-publish the body paragraphs.
  const paras = Array.from(el.querySelectorAll("p"));
  paras.forEach((p, i) => {
    resetPublisherAttrs(p);
    p.setAttribute("class", i === 0 ? "para first" : "para");
  });

  // Assemble <article class="chapter">: header, then the kept body nodes.
  const article = make("article");
  article.setAttribute("class", "chapter");
  article.appendChild(header);

  const kept: ChildNode[] = [];
  el.childNodes.forEach((node) => {
    if (
      node.nodeType === 1 &&
      NON_BODY_TAGS.has((node as Element).tagName.toUpperCase())
    ) {
      return;
    }
    kept.push(node);
  });
  kept.forEach((node) => article.appendChild(node));

  // Put the article where the wrapper's content lived.
  const parent = el.parentNode;
  const wrapperIsRootish =
    el.tagName.toUpperCase() === "BODY" ||
    el === doc.documentElement ||
    !parent ||
    parent.nodeType !== 1;

  if (wrapperIsRootish) {
    el.appendChild(article);
  } else {
    el.replaceWith(article);
  }

  return article;
}
