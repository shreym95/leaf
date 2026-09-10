/**
 * Leaf — book-content theme builder (design layer).
 *
 * Produces the style object handed to epub.js `rendition.themes.register(...)`
 * so the book iframe matches Leaf's chrome. Shape: a map of CSS selector ->
 * declaration object, which is what epub.js expects.
 *
 * Self-contained by design: it must NOT import from `src/reader` or anywhere
 * outside `src/design`. The palettes are duplicated here (rather than read
 * from tokens.css) because the book renders in a separate document that does
 * not inherit the host page's custom properties. Values are kept in lockstep
 * with tokens.css / the approved v0.1 prototype.
 *
 * INERT in M0 — nothing calls this until M3.
 *
 * M3: wired into rendition.hooks via src/reader/content-hook.ts
 */

import type { ThemeId } from "./themes";

/** The subset of palette values the book content needs. Mirrors tokens.css. */
interface ContentPalette {
  page: string;
  ink: string;
  inkMid: string;
  faint: string;
  accent: string;
  rule: string;
  selection: string;
}

const PALETTES: Record<ThemeId, ContentPalette> = {
  day: {
    // Warm laid paper — these must stay byte-identical to the `[data-theme="day"]`
    // block in tokens.css. The book renders in an iframe that cannot read the
    // host's custom properties, so every palette value exists twice; a change
    // here without the matching one there turns the chrome one colour and leaves
    // the page another (docs/DESIGN.md §3).
    page: "#ede2cb",
    ink: "#2b2218",
    inkMid: "#5e503f",
    faint: "#6a5c48",
    accent: "#9e472a",
    rule: "#8f7d55",
    selection: "rgba(158, 71, 42, 0.22)",
  },
  night: {
    page: "#1a1611",
    ink: "#e0d5bd",
    inkMid: "#a89a78",
    faint: "#8f815f",
    accent: "#c58a52",
    rule: "#706449",
    selection: "rgba(197, 138, 82, 0.24)",
  },
};

/** Font stacks for the book iframe. next/font vars are unavailable there, so
 *  name the families directly with graceful fallbacks. */
const BODY_FONT = '"EB Garamond", Garamond, "Times New Roman", serif';
const DISPLAY_FONT = '"Fraunces", Georgia, serif';

/**
 * Printer's fleuron closing every chapter (REVISED_PLAN §6 Phase 2).
 *
 * The glyph is deliberately a ONE-LINE change — swap the character here and
 * nothing else moves. Its single style rule is `.chapter-end` in
 * `buildContentTheme` below; `src/reader/content-hook.ts` only injects the
 * node. Alternatives the founder may want: ❦ ❧ ⚜ ✦ (also ✽ ❈ ⁂).
 */
export const CHAPTER_END_ORNAMENT = "❦";

export type ContentThemeStyles = Record<string, Record<string, string>>;

/**
 * Build the epub.js-registerable style object for a theme.
 *
 * @param themeId - a registered Leaf theme id (`"day"` | `"night"`).
 */
export function buildContentTheme(themeId: ThemeId): ContentThemeStyles {
  const p = PALETTES[themeId];

  return {
    // Reset publisher styling and set the reading surface.
    body: {
      background: p.page,
      color: p.ink,
      "font-family": BODY_FONT,
      "font-size": "1.06rem",
      "line-height": "1.62",
      "text-align": "justify",
      "-webkit-hyphens": "auto",
      hyphens: "auto",
      "hyphenate-limit-chars": "6 3 3",
      margin: "0",
      padding: "0",
    },

    p: {
      margin: "0",
      "text-indent": "1.35em",
      "font-family": BODY_FONT,
      "line-height": "1.62",
      orphans: "2",
      widows: "2",
    },

    // Chapter title (from an <hgroup> title, per the normalizer). Large,
    // bold and centred — the dominant element of a chapter opening.
    h1: {
      "font-family": DISPLAY_FONT,
      "font-weight": "700",
      "font-size": "2.5rem",
      "line-height": "1.15",
      color: p.ink,
      "text-align": "center",
      "text-indent": "0",
      margin: "0",
    },

    // Chapter header block — centred, with generous air above (the top of a
    // chapter's opening page) and below (before the first paragraph).
    ".chapter-head": {
      "text-align": "center",
      "text-indent": "0",
      margin: "3rem 0 3rem",
    },

    // Ordinal eyebrow (e.g. "Chapter I", "V") above the title: small, quiet,
    // regular weight, sentence case — a caption, not a shout. Plain (not
    // uppercase/wide-tracked) so it reads as the ordinal text itself
    // ("Chapter V"), not a stylised label.
    ".chapter-ordinal": {
      display: "block",
      "font-family": DISPLAY_FONT,
      "font-size": "0.9rem",
      "font-weight": "400",
      color: p.accent,
      "text-indent": "0",
      margin: "0 0 0.85rem",
    },

    ".chapter-title": {
      "font-family": DISPLAY_FONT,
      "font-weight": "700",
      color: p.ink,
      "text-align": "center",
      "text-indent": "0",
    },

    // The normalizer's last-resort "§" ordinal (no heading of any kind found —
    // an unstructured Calibre export) is never a meaningful chapter number.
    // It still carries the base `.chapter-ordinal` class (and its DOM node is
    // kept — the fleuron-suppression logic in content-hook.ts reads its text),
    // but this second class hides it: a lone "§" above a chapter is worse than
    // no ordinal line at all.
    ".chapter-ordinal--fallback": {
      display: "none",
    },

    // First paragraph: no indent, drop cap + small-caps lede.
    ".para.first": {
      "text-indent": "0",
      margin: "0",
    },
    ".para.first::first-letter": {
      float: "left",
      "font-family": DISPLAY_FONT,
      "font-weight": "500",
      "font-size": "3.2em",
      "line-height": "0.82",
      padding: "0.05em 0.08em 0 0",
      color: p.accent,
    },
    ".para.first::first-line": {
      "font-variant": "small-caps",
      "font-feature-settings": '"smcp" 1',
      "letter-spacing": "0.02em",
      color: p.inkMid,
    },

    // Printer's fleuron closing the chapter (glyph: CHAPTER_END_ORNAMENT).
    // THE one place to restyle the ornament — centred, accent, display face,
    // generous air above. It is excluded from the pipeline's settings/palette
    // `!important` overrides (like `.chapter-ordinal`), so plain values hold.
    ".chapter-end": {
      display: "block",
      "text-align": "center",
      "text-indent": "0",
      "font-family": DISPLAY_FONT,
      "font-size": "1.5rem",
      "line-height": "1",
      color: p.accent,
      margin: "3rem 0 0",
      "user-select": "none",
    },

    "::selection": {
      background: p.selection,
    },
  };
}
