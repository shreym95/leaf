// Content pipeline — wires the normalizer + the fine-press stylesheet into
// epub.js. LOGIC layer, with ONE sanctioned exception to the design seam: it
// imports `buildContentTheme` from `src/design/content-theme.ts`. That module is
// a plain data builder (selector -> declaration map) explicitly designated as
// the bridge for feeding epub.js `rendition.themes` — it is data, not
// presentation code, and lives in the design layer so a UI overhaul touches it
// there. The ESLint seam rule carries a matching per-file exception.
//
// What this does, per rendered chapter (SPEC §7, §8):
//   1. `normalizeChapterDom` rewrites the chapter DOM to `<article class="chapter">`
//      (ordinal eyebrow, Fraunces title, first-paragraph drop-cap/lede target),
//      resetting publisher attributes. Tiered + never fatal.
//   2. Injects a single `<style id="leaf-content-pipeline">` into the chapter
//      document carrying the fine-press rules (from `buildContentTheme`), the
//      live reading settings (font / size / spacing / measure), and a hard
//      `!important` palette override so Day/Night always wins the cascade.
// This injected `<style>` is the ONE source of truth for content styling — it is
// re-appended (moved last) on every refresh, so epub.js's own injected styles
// can never out-order it. We deliberately do NOT use `rendition.themes.select`
// for Day/Night: epub.js keeps every registered theme's rules present per
// content and doesn't cleanly toggle, which left the theme "stuck" after one flip.

import type { Rendition } from "epubjs";

import {
  buildContentTheme,
  CHAPTER_END_ORNAMENT,
  type ContentThemeStyles,
} from "@/design/content-theme";
import { DEFAULT_THEME, isThemeId, type ThemeId } from "@/design/themes";
import { normalizeChapterDom } from "@/normalizer";

// The engine owns this type; re-exported here so existing importers of
// `@/reader/content-hook` keep resolving. Type-only import — no runtime cycle.
export type { ReaderContentSettings } from "./engine";
import type { ReaderContentSettings } from "./engine";

/**
 * Handle returned by `registerContentPipeline`.
 *
 * Callable form === `destroy()` so callers that expect a bare teardown function
 * (`const teardown = registerContentPipeline(...); teardown()`) keep working.
 */
export interface ContentPipelineHandle {
  (): void;
  /** Re-select the theme + re-inject the stylesheet for every live chapter.
   *  Call after `engine.applySettings` so a Day/Night or font change lands
   *  without a re-render. */
  refresh(): void;
  /** Deregister the content hook. */
  destroy(): void;
}

const STYLE_ID = "leaf-content-pipeline";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** Curated body-font stacks (the iframe can't see the host's `--leaf-font-*`). */
const FONT_STACKS: Record<ReaderContentSettings["fontFamily"], string> = {
  serif: '"EB Garamond", Garamond, "Times New Roman", serif',
  sans: '"Source Sans 3", Inter, system-ui, sans-serif',
  legible: '"Atkinson Hyperlegible", "Source Sans 3", system-ui, sans-serif',
};

/**
 * `margins` -> the text block's side padding plus a max measure.
 *
 * The padding is what actually does the work: `max-width` alone is a no-op on a
 * phone, where the column is far narrower than any sane measure. Values are in
 * `rem` (not `%`) because a percentage inside epub.js's multi-column layout
 * resolves against the full scroll width, not the visible column.
 */
const MARGIN_STYLE: Record<
  ReaderContentSettings["margins"],
  { pad: string; measure: string }
> = {
  narrow: { pad: "0rem", measure: "40rem" },
  normal: { pad: "1.25rem", measure: "34rem" },
  wide: { pad: "2.75rem", measure: "30rem" },
};

/**
 * Narrow the persisted theme to a registered id.
 *
 * This used to be `s.theme === "night" ? "night" : "day"`, which silently
 * rendered any unrecognised theme as Day — so adding Sepia would have painted
 * the chrome sepia and left the book's page white. Fall back to the registry's
 * own default instead of guessing, and let an unknown id be visible as "the
 * default", never as "day".
 */
function themeId(s: ReaderContentSettings): ThemeId {
  return isThemeId(s.theme) ? s.theme : DEFAULT_THEME;
}

/** Serialize a `buildContentTheme` style map to a CSS string. */
function serialize(styles: ContentThemeStyles): string {
  return Object.entries(styles)
    .map(([selector, decl]) => {
      const body = Object.entries(decl)
        .map(([prop, value]) => `${prop}:${value}`)
        .join(";");
      return `${selector}{${body}}`;
    })
    .join("\n");
}

/**
 * The live-settings layer, appended after the fine-press base so it wins.
 *
 * Size / family / spacing are `!important` and target the text elements
 * directly, not just `body`: publisher stylesheets (Gutenberg especially) often
 * set their own `font-size` on `p`/`div`, which out-specifies an inherited
 * `body` rule and silently pins the reader's text size. The ordinal eyebrow and
 * the drop cap are excluded — they size themselves off the fine-press base.
 */
function settingsCss(s: ReaderContentSettings): string {
  const font = FONT_STACKS[s.fontFamily];

  const { pad, measure } = MARGIN_STYLE[s.margins];

  // Containers a publisher rule can style (a `2em` or a `bold` on any of these
  // cascades into every paragraph — one retail EPUB rendered its whole body at
  // 2x and bold this way). Neutralised so size/weight/style are decided by
  // `body` / `.chapter`, never by the file. Inline `<strong>` / `<em>` are
  // untouched, so real emphasis survives.
  const CONTAINERS = ["div", "section", "article", "main", "body > *"].join(",");

  // Text elements. Headings are deliberately excluded: they stay relative to
  // the pinned wrapper, so they scale with S/M/L but keep their hierarchy.
  // `.chapter-end` (the fleuron) is excluded too — it is decoration, styled
  // once by the fine-press base, exactly like `.chapter-ordinal`.
  const TEXT = ["p", "li", "blockquote", "td", "dd", "figcaption"]
    .map(
      (sel) =>
        `${sel}:not(.chapter-ordinal):not(.chapter-title):not(.chapter-end)`,
    )
    .join(",");

  return [
    `body{font-family:${font} !important;font-size:${s.fontSize}rem !important;line-height:${s.lineSpacing} !important;font-weight:400 !important}`,
    // Our wrapper is pinned absolutely — it is the size anchor for the chapter,
    // and its class specificity beats the element reset below. The side padding
    // is the margins control; the max-width caps the measure on wide screens.
    `.chapter{font-size:${s.fontSize}rem !important;line-height:${s.lineSpacing} !important;` +
      `font-weight:400 !important;max-width:${measure};` +
      // `!important` on the insets: the container reset below is itself
      // `!important`, which would otherwise beat this rule's higher specificity.
      `margin-left:auto !important;margin-right:auto !important;` +
      `padding-left:${pad} !important;padding-right:${pad} !important;box-sizing:border-box}`,
    // Zero the containers' own horizontal insets too: Gutenberg wraps content in
    // divs carrying `margin-left/right: 10%`, which stacked on top of our
    // padding and squeezed the column to ~10 characters on a phone. `.chapter`
    // (class specificity) keeps the padding this rule strips from bare
    // `article`/`div`, so the margins control stays the only inset that applies.
    `${CONTAINERS}{font-size:1em !important;font-weight:400 !important;font-style:normal !important;` +
      `margin-left:0 !important;margin-right:0 !important;padding-left:0 !important;padding-right:0 !important}`,
    `${TEXT}{font-family:${font} !important;font-size:1em !important;line-height:${s.lineSpacing} !important;` +
      // Publisher hanging indents (Gutenberg's boilerplate uses a -68px
      // text-indent with a matching left margin) would otherwise survive and
      // shred the measure on a phone.
      `font-weight:400 !important;margin-left:0 !important;margin-right:0 !important}`,
    // Paragraph indentation is ours, not the file's.
    `.chapter .para{text-indent:1.35em !important}`,
    `.chapter .para.first{text-indent:0 !important}`,
    // Real emphasis is markup, not a publisher class — keep it.
    `strong,b{font-weight:700 !important}`,
    `em,i{font-style:italic !important}`,
  ].join("\n");
}

/** Hard palette override — last, `!important`, so nothing epub.js injects can
 *  win the cascade for the reading surface + text colour. */
function hardPalette(styles: ContentThemeStyles): string {
  const bg = styles.body?.background ?? "";
  const ink = styles.body?.color ?? "";
  const sel = styles["::selection"]?.background ?? "";
  return [
    bg && `html,body{background:${bg} !important}`,
    // reading text only — leave `.chapter-ordinal` / drop cap / the fleuron
    // (`.chapter-end`) on their accent
    ink &&
      `body,.chapter p:not(.chapter-ordinal):not(.chapter-end){color:${ink} !important}`,
    sel && `::selection{background:${sel} !important}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function stylesheetFor(s: ReaderContentSettings): string {
  const styles = buildContentTheme(themeId(s));
  return [serialize(styles), settingsCss(s), hardPalette(styles)].join("\n");
}

/** Where a `<style>` can be parked in a (possibly XML) chapter document. */
function styleHost(doc: Document): Element | null {
  return (
    doc.head ??
    doc.querySelector("head") ??
    doc.body ??
    doc.querySelector("body") ??
    doc.documentElement ??
    null
  );
}

function injectStylesheet(doc: Document, css: string): void {
  const host = styleHost(doc);
  if (!host) return;
  let style = doc.querySelector(`style[id="${STYLE_ID}"]`);
  if (!style) {
    style = doc.createElementNS(XHTML_NS, "style");
    style.setAttribute("id", STYLE_ID);
  }
  style.textContent = css;
  // Re-append so our stylesheet is always the LAST in <head> — it out-orders
  // anything epub.js injects on (re)render, which is what makes Day/Night
  // reliably flip in place.
  host.appendChild(style);
}

/** Any section with under this much text is treated as not-a-chapter (part
 *  dividers, half-titles, epigraphs, dedications, a table of contents). The
 *  shortest real chapters — a page or two of prose — clear it comfortably. */
const MIN_CHAPTER_TEXT = 500;

/** An UNSTRUCTURED section (the normalizer's "§" fallback) needs more than this
 *  to count as a chapter. Calibre exports carry no headings or `epub:type`, so
 *  every one of their sections is "§" — a real chapter runs to thousands of
 *  characters, whereas "Also by…", the copyright page and "About the author"
 *  sit in the hundreds. Structured sections (a real ordinal or title) are not
 *  held to this — only `MIN_CHAPTER_TEXT`. */
const MIN_UNSTRUCTURED_CHAPTER_TEXT = 1200;

/** `epub:type` tokens (on `<body>` or the wrapper) that mark a section as NOT a
 *  chapter. Standard Ebooks / well-formed EPUBs tag these; `frontmatter` and
 *  `backmatter` alone cover most of it (a long publisher's introduction or a
 *  colophon that would clear the length floors). Calibre tags nothing, which is
 *  why the length floors above still have to carry that case. */
const NON_CHAPTER_EPUB_TYPES = new Set([
  "frontmatter",
  "backmatter",
  "cover",
  "titlepage",
  "halftitlepage",
  "colophon",
  "imprint",
  "copyright-page",
  "dedication",
  "epigraph",
  "acknowledgements",
  "toc",
  "landmarks",
  "loi",
  "lot",
]);

const EPUB_NS = "http://www.idpf.org/2007/ops";

/** Whitespace-collapsed length of an element's text. */
function textLength(el: Element | null): number {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim().length;
}

/**
 * True when this chapter document is really front/back matter and must stay
 * clean of the fleuron. Must be read from the RAW doc: step 1 replaces the
 * `<section epub:type="…">` wrapper with `<article class="chapter">`, taking the
 * section-level type with it (a `<body epub:type="frontmatter">`, as Standard
 * Ebooks writes it, does survive — but Calibre/Gutenberg put nothing there).
 */
function isNonChapterSection(doc: Document): boolean {
  const hosts = [
    doc.body ?? doc.querySelector("body"),
    doc.querySelector("body > section, body > article, body > nav"),
  ];
  for (const host of hosts) {
    if (!host) continue;
    const raw =
      host.getAttributeNS(EPUB_NS, "type") ??
      host.getAttribute("epub:type") ??
      "";
    for (const token of raw.split(/\s+/)) {
      if (NON_CHAPTER_EPUB_TYPES.has(token)) return true;
    }
    // Project Gutenberg wraps its licence boilerplate in these.
    const marker = `${host.getAttribute("id") ?? ""} ${host.getAttribute("class") ?? ""}`;
    if (/pg-?(header|footer|boilerplate)/i.test(marker)) return true;
  }
  return false;
}

/**
 * Append the printer's fleuron (REVISED_PLAN §6 Phase 2) to a normalized
 * chapter — a small centred ornament that gives visual breath between chapters.
 *
 * Decoration only: `aria-hidden` so a screen reader never voices it. The glyph
 * (`CHAPTER_END_ORNAMENT`) and its single style rule (`.chapter-end`) both live
 * in `src/design/content-theme.ts`; this function only places the node.
 *
 * NOT on front/back matter. The exclusion rule, stated once — skip when ANY of:
 *   1. the section is tagged front/back matter (`epub:type`, checked on the raw
 *      doc via `nonChapter`) — a titled introduction or colophon that would
 *      otherwise clear the length floors;
 *   2. it carries less than `MIN_CHAPTER_TEXT` characters of text — part
 *      dividers, half-titles, epigraphs, a contents page;
 *   3. the normalizer found no heading (ordinal is the "§" fallback) AND it is
 *      under `MIN_UNSTRUCTURED_CHAPTER_TEXT` — a Calibre/Gutenberg "Also by",
 *      copyright or author-bio page, which has no structure and little prose.
 * A real chapter clears all three.
 *
 * Called on the first (raw) pass only — the caller skips it on a re-parse of an
 * already-normalized chapter. The `p.chapter-end` guard below is then just
 * belt-and-suspenders against a double call on the same first-pass document
 * (the unit tests, and any epub.js quirk). Must run BEFORE the `"expand"`
 * re-measure so the extra trailing height is in the DOM when epub.js
 * re-measures the chapter width (DEFECTS D2 / D5).
 */
function appendChapterEndOrnament(doc: Document, nonChapter: boolean): void {
  const article = doc.querySelector("article.chapter");
  if (!article) return;

  // Never stack ornaments if this fires twice on one document.
  if (article.querySelector("p.chapter-end")) return;

  // 1. Tagged front/back matter.
  if (nonChapter) return;

  const chars = textLength(article);
  // 2. Too little text to be a chapter.
  if (chars < MIN_CHAPTER_TEXT) return;

  // 3. Unstructured ("§") and not long enough to be a bare-markup chapter.
  const ordinal = article
    .querySelector(".chapter-ordinal")
    ?.textContent?.trim();
  if (ordinal === "§" && chars < MIN_UNSTRUCTURED_CHAPTER_TEXT) return;

  const p = doc.createElementNS(XHTML_NS, "p");
  p.setAttribute("class", "chapter-end");
  p.setAttribute("aria-hidden", "true");
  p.textContent = CHAPTER_END_ORNAMENT;
  article.appendChild(p);
}

/** The shape of an epub.js `Contents` we actually use. */
interface ContentsLike {
  document?: Document;
  sectionIndex?: number;
  emit?: (name: string, ...args: unknown[]) => void;
}

/** A `Contents` whose chapter document is present — i.e. one we can restyle. */
type LiveContents = ContentsLike & { document: Document };

/** epub.js `getContents()` returns an array at runtime (its types say singular). */
function contentObjects(rendition: Rendition): LiveContents[] {
  const getContents = (
    rendition as unknown as {
      getContents?: () => unknown;
    }
  ).getContents;
  if (typeof getContents !== "function") return [];
  const result = getContents.call(rendition);
  const list = Array.isArray(result) ? result : [result];
  return list.filter(
    (c): c is LiveContents => !!(c as ContentsLike | null)?.document,
  );
}

/**
 * Tell epub.js to re-measure the chapter iframe after we have restyled it.
 *
 * epub.js sizes the iframe to the chapter as the *publisher* wrote it: the
 * first `expand()` runs inside `view.render()`, before this hook has injected
 * anything. Our stylesheet then changes the measure, the type size and the
 * leading, so the text occupies materially more columns than the iframe epub.js
 * sized — on a phone, `Peaches in Combat` went from 3010px to 5160px.
 *
 * Until the view's ResizeObserver catches up a frame or two later, the
 * rendition container's `scrollWidth` is short, and epub.js's
 * `managers/default/index.js` `moveTo()` silently clamps any restore past that
 * width to `scrollWidth - delta` — dropping the reader pages back into the
 * chapter (DEFECTS D5: entering immersive at a chapter end landed 5 pages
 * earlier). Every restore that has to re-create the view is affected: immersive
 * enter/exit, a window resize, and reopening the book on a saved position.
 *
 * `"expand"` is epub.js's own "the content changed size" signal and the view
 * handles it synchronously, so the iframe is correct before the restoring
 * `moveTo()` runs on the next microtask.
 */
function remeasure(contents: ContentsLike | null | undefined): void {
  try {
    if (typeof contents?.emit === "function") contents.emit("expand");
  } catch {
    // Older/other epub.js — its own ResizeObserver still catches up eventually.
  }
}

function bookMeta(rendition: Rendition): {
  title: string;
  author: string;
  total: number;
} {
  const book = (
    rendition as unknown as {
      book?: {
        packaging?: { metadata?: { title?: string; creator?: string } };
        spine?: { length?: number };
      };
    }
  ).book;
  return {
    title: book?.packaging?.metadata?.title ?? "",
    author: book?.packaging?.metadata?.creator ?? "",
    total: book?.spine?.length ?? 0,
  };
}

/**
 * Wire the normalizer + fine-press stylesheet into a rendition.
 *
 * Call BEFORE the first `rendition.display()` so chapter one renders through the
 * pipeline.
 *
 * @param rendition   the epub.js rendition.
 * @param getSettings closure onto the engine's current `ReaderContentSettings`.
 */
export function registerContentPipeline(
  rendition: Rendition,
  getSettings: () => ReaderContentSettings,
): ContentPipelineHandle {
  const meta = bookMeta(rendition);

  const onContent = (a: unknown, _b?: unknown): void => {
    const holder = a as
      | (ContentsLike & { contents?: ContentsLike })
      | null
      | undefined;
    const contents = holder?.document ? holder : holder?.contents;
    const doc = contents?.document;
    if (!doc) return;

    const settings = getSettings();

    // Is this a first (raw publisher) pass, or a re-parse of a chapter we
    // already normalized? On every relayout epub.js re-serializes the section's
    // cached (already-rewritten) DOM into a fresh iframe and fires this hook
    // again — so the fleuron decision, which needs raw `epub:type` / Gutenberg
    // markers that normalization destroys, is made ONCE here and never revisited
    // (the ornament node, or its absence, then rides along in the serialized
    // DOM). `normalizeChapterDom` guards itself the same way.
    const firstPass = !doc.querySelector(
      "article.chapter > header.chapter-head",
    );

    // Read `epub:type` before step 1 removes the section wrapper it sits on.
    let nonChapter = false;
    if (firstPass) {
      try {
        nonChapter = isNonChapterSection(doc);
      } catch {
        /* not fatal — the length floors still guard the fleuron */
      }
    }

    // 1. Structural rewrite — tiered, and never fatal to rendering (SPEC §7).
    try {
      normalizeChapterDom(doc, {
        bookTitle: meta.title,
        author: meta.author,
        index: holder?.sectionIndex ?? 0,
        total: meta.total,
      });
    } catch {
      /* messy chapter — fall through to the safe restyle below */
    }

    // 1b. Printer's fleuron closing the chapter — decoration, front matter
    //     excluded. First pass only (see `firstPass`); before the stylesheet +
    //     re-measure so its trailing height is counted when epub.js re-measures
    //     the column (DEFECTS D2 / D5).
    if (firstPass) {
      try {
        appendChapterEndOrnament(doc, nonChapter);
      } catch {
        /* the ornament is cosmetic — never let it break a render */
      }
    }

    // 2. Fine-press + live-settings stylesheet into the chapter document.
    try {
      injectStylesheet(doc, stylesheetFor(settings));
    } catch {
      /* non-fatal */
    }

    // 3. Steps 1 and 2 changed how wide the chapter is; epub.js measured it
    //    before either ran. Make it re-measure NOW, while the restore that
    //    follows still depends on the answer.
    remeasure(contents);
  };

  rendition.hooks.content.register(onContent);

  const refresh = (): void => {
    const css = stylesheetFor(getSettings());
    for (const contents of contentObjects(rendition)) {
      try {
        injectStylesheet(contents.document, css);
      } catch {
        /* non-fatal */
      }
      remeasure(contents);
    }
  };

  const destroy = (): void => {
    try {
      rendition.hooks.content.deregister(onContent);
    } catch {
      /* hook list already cleared by rendition.destroy() */
    }
  };

  return Object.assign(() => destroy(), { refresh, destroy });
}
