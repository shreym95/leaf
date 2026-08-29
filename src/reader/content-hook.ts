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

/** `margins` -> a comfortable measure (max line length), centred. epub.js owns
 *  the column geometry, so we constrain the text block, not the body padding. */
const MEASURE: Record<ReaderContentSettings["margins"], string> = {
  narrow: "31rem",
  normal: "34rem",
  wide: "40rem",
};

function themeId(s: ReaderContentSettings): "day" | "night" {
  return s.theme === "night" ? "night" : "day";
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

  // Containers a publisher rule can inflate (a `2em` on any of these used to
  // cascade into every paragraph, doubling the text). Reset to 1em so the
  // reading size is decided by `body` / `.chapter`, never by the file.
  const CONTAINERS = ["div", "section", "article", "main", "body > *"].join(",");

  // Text elements. Headings are deliberately excluded: they stay relative to
  // the pinned wrapper, so they scale with S/M/L but keep their hierarchy.
  const TEXT = ["p", "li", "blockquote", "td", "dd", "figcaption"]
    .map((sel) => `${sel}:not(.chapter-ordinal):not(.chapter-title)`)
    .join(",");

  return [
    `body{font-family:${font} !important;font-size:${s.fontSize}rem !important;line-height:${s.lineSpacing} !important}`,
    // Our wrapper is pinned absolutely — it is the size anchor for the chapter,
    // and its class specificity beats the element reset below.
    `.chapter{font-size:${s.fontSize}rem !important;line-height:${s.lineSpacing} !important;max-width:${MEASURE[s.margins]};margin-left:auto;margin-right:auto}`,
    `${CONTAINERS}{font-size:1em !important}`,
    `${TEXT}{font-family:${font} !important;font-size:1em !important;line-height:${s.lineSpacing} !important}`,
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
