"use client";

import { useEffect } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import {
  useReaderSettings,
  type ReaderTheme,
  type FontFamily,
  type Margins,
} from "@/store/reader-settings";
import { isThemeId } from "@/design/themes";

/**
 * ThemeSync — makes the reader's persisted settings the single source of truth
 * for the theme across the whole app.
 *
 * There used to be two: the chrome toggled `<html data-theme>` and wrote
 * localStorage, while the reader read `reader_settings.theme` from the database.
 * Switch the library to Day, open a book, and the reader's stored Night value
 * won and flipped everything back — the theme appeared to change by itself.
 *
 * Now the chrome hydrates the same store the reader uses and follows it, so a
 * toggle anywhere persists everywhere and follows the reader across devices.
 * localStorage stays as the pre-paint cache that avoids a flash before this
 * component has mounted.
 *
 * Hydrates the WHOLE settings row, not just the theme: the store persists all
 * five values together, so a partial hydrate would write typography defaults
 * over the reader's real choices on the next toggle.
 */

export interface ThemeSyncProps {
  userId: string;
  settings: {
    fontFamily: FontFamily;
    fontSize: number;
    lineSpacing: number;
    margins: Margins;
    theme: ReaderTheme;
  };
}

export function ThemeSync({ userId, settings }: ThemeSyncProps) {
  const { setTheme } = useTheme();
  const storeTheme = useReaderSettings((s) => s.theme);

  useEffect(() => {
    useReaderSettings.getState().hydrate(settings, userId);
    // Seeded once per mount from the server row; the store owns it after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (isThemeId(storeTheme)) setTheme(storeTheme);
  }, [storeTheme, setTheme]);

  return null;
}
