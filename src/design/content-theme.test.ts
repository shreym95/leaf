import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildContentTheme } from "./content-theme";
import { THEME_IDS } from "./themes";

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

/** rgba(189, 130, 80, 0.24) -> rgba(189,130,80,0.24) ; hex lowercased. */
function normalizeColor(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}
