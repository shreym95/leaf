/**
 * Leaf — book-content theme builder (design layer).
 *
 * Produces the style object handed to epub.js `rendition.themes.register(...)`
 * so the book iframe matches Leaf's chrome. Shape: a map of CSS selector ->
 * declaration object, which is what epub.js expects.
 *
 * Self-contained by design: it must NOT import from `src/reader` or anywhere
 * outside `src/design`. The two palettes are duplicated here (rather than read
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
    page: "#f1ebdc",
    ink: "#26200f",
    inkMid: "#5c5237",
    faint: "#6a5f45",
    accent: "#8a2b1e",
    rule: "#cabf9f",
    selection: "rgba(138, 43, 30, 0.2)",
  },
  night: {
    page: "#1a1611",
    ink: "#e0d5bd",
    inkMid: "#a89a78",
    faint: "#8f815f",
    accent: "#c58a52",
    rule: "#3a3020",
    selection: "rgba(197, 138, 82, 0.24)",
  },
};

/** Font stacks for the book iframe. next/font vars are unavailable there, so
 *  name the families directly with graceful fallbacks. */
const BODY_FONT = '"EB Garamond", Garamond, "Times New Roman", serif';
const DISPLAY_FONT = '"Fraunces", Georgia, serif';

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

    // Chapter title (from an <hgroup> title, per the normalizer).
    h1: {
      "font-family": DISPLAY_FONT,
      "font-weight": "400",
      "font-size": "1.9rem",
      "line-height": "1.2",
      color: p.ink,
      "text-align": "left",
      "text-indent": "0",
      margin: "0 0 1.5rem",
    },

    // Ordinal eyebrow (e.g. "I", "V") above the title.
    ".chapter-ordinal": {
      display: "block",
      "font-family": DISPLAY_FONT,
      "font-size": "0.74rem",
      "font-weight": "500",
      "letter-spacing": "0.34em",
      "text-transform": "uppercase",
      color: p.accent,
      "text-indent": "0",
      margin: "0 0 0.75rem",
    },

    ".chapter-title": {
      "font-family": DISPLAY_FONT,
      "font-weight": "400",
      color: p.ink,
      "text-indent": "0",
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

    "::selection": {
      background: p.selection,
    },
  };
}
