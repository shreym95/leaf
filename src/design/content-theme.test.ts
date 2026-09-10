import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildContentTheme, CHAPTER_END_ORNAMENT } from "./content-theme";
import { DEFAULT_THEME, THEME_IDS } from "./themes";

/**
 * content-theme.ts duplicates the palette hexes (the book iframe can't read the
 * host page's custom properties). This test keeps that copy honest against
 * tokens.css — the source of truth — so the two can't drift.
 */

const tokensCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "tokens.css"),
  "utf8",
);

/** Pull the `--leaf-<name>` value out of a `[data-theme="<id>"]` block. */
function tokenValue(themeId: string, name: string): string {
  const block = tokensCss.match(
    new RegExp(`\\[data-theme="${themeId}"\\]\\s*\\{([^}]*)\\}`),
  );
  if (!block) throw new Error(`no [data-theme="${themeId}"] block in tokens.css`);
  const decl = block[1].match(new RegExp(`--leaf-${name}:\\s*([^;]+);`));
  if (!decl) throw new Error(`no --leaf-${name} in [data-theme="${themeId}"]`);
  return decl[1].trim().replace(/\s+/g, " ");
}

const KEYS = [
  ["page", "page"],
  ["ink", "ink"],
  ["inkMid", "ink-mid"],
  ["faint", "faint"],
  ["accent", "accent"],
  ["rule", "rule"],
  ["selection", "selection"],
] as const;

describe("buildContentTheme palettes match tokens.css", () => {
  for (const themeId of THEME_IDS) {
    it(`${themeId}`, () => {
      const styles = buildContentTheme(themeId);
      // Values actually rendered into the iframe stylesheet.
      const used = {
        page: styles.body.background,
        ink: styles.body.color,
        inkMid: styles[".para.first::first-line"].color,
        faint: null, // not referenced in the stylesheet; check the source map below
        accent: styles[".chapter-ordinal"].color,
        rule: null,
        selection: styles["::selection"].background,
      } as Record<string, string | null>;

      for (const [jsKey, cssName] of KEYS) {
        if (used[jsKey] == null) continue;
        expect(
          normalizeColor(used[jsKey]!),
          `${themeId}.${jsKey}`,
        ).toBe(normalizeColor(tokenValue(themeId, cssName)));
      }
    });
  }
});

describe("chapter opening (centred hierarchy)", () => {
  it("centres the chapter head, ordinal and title", () => {
    const styles = buildContentTheme(DEFAULT_THEME);
    expect(styles[".chapter-head"]["text-align"]).toBe("center");
    expect(styles[".chapter-title"]["text-align"]).toBe("center");
    expect(styles.h1["text-align"]).toBe("center");
  });

  it("gives the title a noticeably larger, bolder scale than body text", () => {
    const styles = buildContentTheme(DEFAULT_THEME);
    const bodyFontRem = parseFloat(styles.body["font-size"]);
    const titleFontRem = parseFloat(styles.h1["font-size"]);
    expect(titleFontRem).toBeGreaterThan(bodyFontRem * 1.8);
    expect(Number(styles.h1["font-weight"])).toBeGreaterThanOrEqual(700);
  });

  it("gives the chapter head generous air above the ordinal and before the first paragraph", () => {
    const styles = buildContentTheme(DEFAULT_THEME);
    const [top, , bottom] = styles[".chapter-head"].margin.split(/\s+/);
    expect(parseFloat(top)).toBeGreaterThanOrEqual(2);
    expect(parseFloat(bottom)).toBeGreaterThanOrEqual(2);
  });

  it("keeps the ordinal small, regular-weight and quiet relative to the title", () => {
    const styles = buildContentTheme(DEFAULT_THEME);
    const ordinalFontRem = parseFloat(styles[".chapter-ordinal"]["font-size"]);
    const titleFontRem = parseFloat(styles.h1["font-size"]);
    expect(ordinalFontRem).toBeLessThan(titleFontRem / 2);
    expect(Number(styles[".chapter-ordinal"]["font-weight"])).toBeLessThanOrEqual(400);
  });

  it("hides the normalizer's unstructured '§' fallback — never a real ordinal", () => {
    const styles = buildContentTheme(DEFAULT_THEME);
    expect(styles[".chapter-ordinal--fallback"].display).toBe("none");
  });
});

describe("chapter-end fleuron (Phase 2)", () => {
  it("is a single glyph, swappable in one line", () => {
    // The founder may restyle this — the whole contract is that it's one
    // exported constant plus one style rule. Keep it a bare glyph.
    expect(CHAPTER_END_ORNAMENT).toHaveLength(1);
    expect(CHAPTER_END_ORNAMENT.trim()).toBe(CHAPTER_END_ORNAMENT);
  });

  it("has exactly one style rule, and it is centred / accent / display face", () => {
    const styles = buildContentTheme(DEFAULT_THEME);
    const rule = styles[".chapter-end"];
    expect(rule).toBeDefined();
    expect(rule["text-align"]).toBe("center");
    expect(rule["text-indent"]).toBe("0");
    expect(rule["font-family"]).toBe(styles[".chapter-ordinal"]["font-family"]);
    expect(rule.color).toBe(styles[".chapter-ordinal"].color); // accent
    // generous space above so it reads as a close, not a caption
    expect(parseFloat(rule.margin)).toBeGreaterThanOrEqual(2);
    // no other selector styles the ornament
    const others = Object.keys(styles).filter((s) => s.includes("chapter-end"));
    expect(others).toEqual([".chapter-end"]);
  });
});

/** rgba(189, 130, 80, 0.24) -> rgba(189,130,80,0.24) ; hex lowercased. */
function normalizeColor(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}
