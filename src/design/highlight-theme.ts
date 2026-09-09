/**
 * Leaf — highlight palette (design layer).
 *
 * Two consumers, two forms:
 *  - the **book iframe**, which cannot see the host page's custom properties,
 *    so `highlightStyles()` returns concrete CSS for epub.js `annotations.add`;
 *  - the **chrome** (colour swatches in the highlight popover), which can, so
 *    `highlightVar()` returns the matching `var(--leaf-hl-*)`.
 *
 * Values are duplicated from `tokens.css` for the same reason `content-theme.ts`
 * duplicates the palette — the iframe is a separate document. A test keeps the
 * two in lockstep.
 *
 * The reader logic layer never imports this: it passes a colour NAME around and
 * receives `stylesFor` from the UI (see `src/reader/highlights.ts`).
 */

import type { ThemeId } from "./themes";

export const HIGHLIGHT_COLORS = ["copper", "sage", "sky", "rose"] as const;
export type HighlightColorName = (typeof HIGHLIGHT_COLORS)[number];

/** Human labels for the swatch buttons' accessible names. */
export const HIGHLIGHT_LABELS: Record<HighlightColorName, string> = {
  copper: "Copper",
  sage: "Sage",
  sky: "Sky",
  rose: "Rose",
};

const WASH: Record<ThemeId, Record<HighlightColorName, string>> = {
  day: {
    copper: "rgba(190, 120, 60, 0.30)",
    sage: "rgba(104, 140, 92, 0.28)",
    sky: "rgba(86, 132, 178, 0.28)",
    rose: "rgba(186, 92, 116, 0.28)",
  },
  night: {
    copper: "rgba(197, 138, 82, 0.34)",
    sage: "rgba(126, 168, 112, 0.30)",
    sky: "rgba(116, 162, 208, 0.30)",
    rose: "rgba(210, 118, 142, 0.30)",
  },
};

export function isHighlightColor(value: unknown): value is HighlightColorName {
  return (
    typeof value === "string" &&
    (HIGHLIGHT_COLORS as readonly string[]).includes(value)
  );
}

/** `var(--leaf-hl-*)` for chrome swatches (host document only). */
export function highlightVar(color: string): string {
  const name = isHighlightColor(color) ? color : HIGHLIGHT_COLORS[0];
  return `var(--leaf-hl-${name})`;
}

/**
 * Concrete styles for an epub.js highlight annotation. epub.js paints these onto
 * an SVG `<rect>` layered under the text, so `fill` (not `background`) is the
 * property that shows.
 */
export function highlightStyles(
  color: string,
  theme: ThemeId,
): Record<string, string> {
  const name = isHighlightColor(color) ? color : HIGHLIGHT_COLORS[0];
  return { fill: WASH[theme][name], "fill-opacity": "1" };
}
