import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_COLORS,
  highlightStyles,
  highlightVar,
  isHighlightColor,
} from "./highlight-theme";
import { THEME_IDS } from "./themes";

// The book iframe cannot read the host page's custom properties, so the wash
// values are duplicated here from tokens.css. This keeps the copy honest.
const tokensCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "tokens.css"),
  "utf8",
);

function tokenValue(themeId: string, name: string): string {
  const block = tokensCss.match(
    new RegExp(`\\[data-theme="${themeId}"\\]\\s*\\{([^}]*)\\}`),
  );
  if (!block) throw new Error(`no [data-theme="${themeId}"] block`);
  const decl = block[1].match(new RegExp(`--leaf-${name}:\\s*([^;]+);`));
  if (!decl) throw new Error(`no --leaf-${name} in ${themeId}`);
  return decl[1].trim().replace(/\s+/g, "");
}

describe("highlight palette", () => {
  it("matches tokens.css for every colour in every theme", () => {
    for (const theme of THEME_IDS) {
      for (const color of HIGHLIGHT_COLORS) {
        expect(
          highlightStyles(color, theme).fill.replace(/\s+/g, ""),
          `${theme}/${color}`,
        ).toBe(tokenValue(theme, `hl-${color}`));
      }
    }
  });

  it("paints via `fill` — epub.js highlights are SVG rects, not backgrounds", () => {
    const styles = highlightStyles("sage", "day");
    expect(styles).toHaveProperty("fill");
    expect(styles).not.toHaveProperty("background");
  });

  it("falls back to the default colour for an unknown name", () => {
    expect(highlightStyles("chartreuse", "day")).toEqual(
      highlightStyles("copper", "day"),
    );
    expect(highlightVar("nonsense")).toBe("var(--leaf-hl-copper)");
  });

  it("exposes chrome swatches as CSS vars, not literals", () => {
    for (const color of HIGHLIGHT_COLORS) {
      expect(highlightVar(color)).toBe(`var(--leaf-hl-${color})`);
    }
  });

  it("guards unknown colour names", () => {
    expect(isHighlightColor("sky")).toBe(true);
    expect(isHighlightColor("teal")).toBe(false);
    expect(isHighlightColor(null)).toBe(false);
  });
});
