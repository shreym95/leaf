// Reader settings store (Zustand v5). Style-agnostic: holds the reader's
// typographic choices as plain data — the design layer + the epub.js engine
// read these values, this file never touches CSS. May import `@/lib` (the
// Supabase browser client) but never `@/design` / `@/components` (ESLint seam).
//
// M3: hydrated from the server-loaded `reader_settings` row and persisted back
// (debounced) via the browser Supabase client + RLS (`user_id = auth.uid()`),
// so choices survive reload and follow the user across devices (SPEC §8).

import { create } from "zustand";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type FontFamily = "serif" | "sans" | "legible";
export type Margins = "narrow" | "normal" | "wide";
export type ReaderTheme = "day" | "night";

export interface ReaderSettingsState {
  /** Curated body font: serif / humanist sans / Atkinson Hyperlegible. */
  fontFamily: FontFamily;
  /** rem */
  fontSize: number;
  lineSpacing: number;
  margins: Margins;
  theme: ReaderTheme;

  setFontFamily: (value: FontFamily) => void;
  setFontSize: (value: number) => void;
  setLineSpacing: (value: number) => void;
  setMargins: (value: Margins) => void;
  setTheme: (value: ReaderTheme) => void;
  reset: () => void;

  /** Seed the store from the server-loaded row (called once, client-side). */
  hydrate: (initial: Partial<ReaderSettingsValues>, userId: string | null) => void;
  /** Flush a pending debounced write immediately (e.g. on unmount). */
  flush: () => void;
}

export type ReaderSettingsValues = Pick<
  ReaderSettingsState,
  "fontFamily" | "fontSize" | "lineSpacing" | "margins" | "theme"
>;

/**
 * Map a `reader_settings` row to the store's shape, falling back to the
 * defaults when the row is missing. Shared so the reader and the app chrome
 * seed from exactly the same values — they used to disagree about the theme.
 */
export function settingsFromRow(
  row: {
    font_family: FontFamily;
    font_size: number;
    line_spacing: number;
    margins: Margins;
    theme: ReaderTheme;
  } | null,
): ReaderSettingsValues {
  if (!row) return { ...READER_SETTINGS_DEFAULTS };
  return {
    fontFamily: row.font_family,
    fontSize: row.font_size,
    lineSpacing: row.line_spacing,
    margins: row.margins,
    theme: row.theme,
  };
}

export const READER_SETTINGS_DEFAULTS: ReaderSettingsValues = {
  fontFamily: "serif",
  fontSize: 1.06,
  lineSpacing: 1.62,
  margins: "normal",
  theme: "night",
};

const VALUE_KEYS: (keyof ReaderSettingsValues)[] = [
  "fontFamily",
  "fontSize",
  "lineSpacing",
  "margins",
  "theme",
];

const PERSIST_DEBOUNCE_MS = 600;

/** Map the camelCase store shape to the snake_case `reader_settings` row. */
function toRow(userId: string, v: ReaderSettingsValues) {
  return {
    user_id: userId,
    font_family: v.fontFamily,
    font_size: v.fontSize,
    line_spacing: v.lineSpacing,
    margins: v.margins,
    theme: v.theme,
  };
}

export const useReaderSettings = create<ReaderSettingsState>((set, get) => {
  let userId: string | null = null;
  let hydrated = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function writeNow(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!userId || !isSupabaseConfigured) return;
    const s = get();
    const values: ReaderSettingsValues = {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineSpacing: s.lineSpacing,
      margins: s.margins,
      theme: s.theme,
    };
    try {
      const supabase = createClient();
      await supabase
        .from("reader_settings")
        .upsert(toRow(userId, values), { onConflict: "user_id" });
    } catch {
      // Persistence is best-effort — a failed write never blocks reading.
      // The next change re-attempts the full upsert.
    }
  }

  function schedulePersist(): void {
    // Don't write while hydrating (the seed IS the server's current value).
    if (!hydrated || !userId) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void writeNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  function apply(patch: Partial<ReaderSettingsValues>): void {
    set(patch);
    schedulePersist();
  }

  return {
    ...READER_SETTINGS_DEFAULTS,

    setFontFamily: (fontFamily) => apply({ fontFamily }),
    setFontSize: (fontSize) => apply({ fontSize }),
    setLineSpacing: (lineSpacing) => apply({ lineSpacing }),
    setMargins: (margins) => apply({ margins }),
    setTheme: (theme) => apply({ theme }),
    reset: () => apply({ ...READER_SETTINGS_DEFAULTS }),

    hydrate: (initial, uid) => {
      const seed: Partial<ReaderSettingsValues> = {};
      for (const key of VALUE_KEYS) {
        if (initial[key] !== undefined) {
          // TS: each key's value type is preserved by the per-key assignment.
          (seed as Record<string, unknown>)[key] = initial[key];
        }
      }
      set(seed);
      userId = uid;
      hydrated = true;
    },

    flush: () => {
      void writeNow();
    },
  };
});
