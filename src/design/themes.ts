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

import type { ThemeName } from "@/lib/types";

export interface ThemeMeta {
  /** Stable id — matches the `data-theme` attribute value and the tokens.css block. */
  id: string;
  /** Human-facing name for the theme switcher. */
  label: string;
}

export const THEMES = {
  // Registry order is display order: light -> dark. The theme picker renders
  // them in this sequence.
  day: { id: "day", label: "Day" },
  night: { id: "night", label: "Night" },
} as const satisfies Record<ThemeName, ThemeMeta>;

/**
 * A theme id is persisted data, so the union is owned by the logic layer
 * (`ThemeName`) and this layer supplies each id's palette and label. Keying the
 * registry off it makes the compiler reject a theme the database would refuse,
 * and makes adding one fail loudly here until its palette exists.
 *
 * The seam still points the right way: design imports a type from lib, never
 * the reverse (SPEC §3.1).
 */
export type ThemeId = ThemeName;

/** All registered theme ids, in registry (display) order. */
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

/** The theme applied when a user has no stored preference. */
export const DEFAULT_THEME: ThemeId = "night";

/** Narrowing helper for untrusted values (e.g. persisted settings, query params). */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && value in THEMES;
}
