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

import { buildContentTheme, type ContentThemeStyles } from "@/design/content-theme";
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
  const TEXT = ["p", "li", "blockquote", "td", "dd", "figcaption"]
    .map((sel) => `${sel}:not(.chapter-ordinal):not(.chapter-title)`)
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
    // reading text only — leave `.chapter-ordinal` / drop cap on their accent
    ink && `body,.chapter p:not(.chapter-ordinal){color:${ink} !important}`,
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

/** epub.js `getContents()` returns an array at runtime (its types say singular). */
function contentDocuments(rendition: Rendition): Document[] {
  const getContents = (
    rendition as unknown as {
      getContents?: () => unknown;
    }
  ).getContents;
  if (typeof getContents !== "function") return [];
  const result = getContents.call(rendition);
  const list = Array.isArray(result) ? result : [result];
  return list
    .map((c) => (c as { document?: Document } | null)?.document)
    .filter((d): d is Document => !!d);
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
      | { document?: Document; sectionIndex?: number; contents?: { document?: Document } }
      | null
      | undefined;
    const doc = holder?.document ?? holder?.contents?.document;
    if (!doc) return;

    const settings = getSettings();

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

    // 2. Fine-press + live-settings stylesheet into the chapter document.
    try {
      injectStylesheet(doc, stylesheetFor(settings));
    } catch {
      /* non-fatal */
    }
  };

  rendition.hooks.content.register(onContent);

  const refresh = (): void => {
    const css = stylesheetFor(getSettings());
    for (const doc of contentDocuments(rendition)) {
      try {
        injectStylesheet(doc, css);
      } catch {
        /* non-fatal */
      }
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
