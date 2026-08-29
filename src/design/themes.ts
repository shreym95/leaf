/**
 * Leaf — theme registry (data, not code).
 *
 * Part of the swappable design layer. Adding a theme = add an entry here; no
 * other file needs a code change. The actual "apply the default on first
 * paint" logic lives outside this layer (layout / store), it just reads
 * DEFAULT_THEME.
 *
 * Each theme id must have a matching `[data-theme="<id>"]` palette block in
 * tokens.css and a palette entry in content-theme.ts.
 */

export interface ThemeMeta {
  /** Stable id — matches the `data-theme` attribute value and the tokens.css block. */
  id: string;
  /** Human-facing name for the theme switcher. */
  label: string;
}

export const THEMES = {
  night: { id: "night", label: "Night" },
  day: { id: "day", label: "Day" },
} as const satisfies Record<string, ThemeMeta>;

export type ThemeId = keyof typeof THEMES;

/** All registered theme ids, in registry (display) order. */
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

/** The theme applied when a user has no stored preference. */
export const DEFAULT_THEME: ThemeId = "night";

/** Narrowing helper for untrusted values (e.g. persisted settings, query params). */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && value in THEMES;
}
