"use client";

import { THEMES, THEME_IDS, type ThemeId } from "@/design/themes";
import { Button } from "@/components/primitives/Button";
import { useReaderSettings, type ReaderTheme } from "@/store/reader-settings";
import { useTheme } from "./ThemeProvider";

/**
 * ThemeToggle — a Button that cycles the theme. Its label names the NEXT theme
 * (shows "Day" while in night), matching the approved v0.1 bar behaviour.
 *
 * Writes to the reader-settings store, not just `<html data-theme>`: the theme
 * is one persisted setting shared with the reader. Toggling here used to change
 * only localStorage, so opening a book restored the theme stored in the database
 * and the app appeared to flip on its own. ThemeSync reflects the store back to
 * the document, so this stays a single write.
 */

function labelFor(id: ThemeId): string {
  return THEMES[id]?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function ThemeToggle({ mono = true }: { mono?: boolean }) {
  const { theme, setTheme } = useTheme();
  const setStoreTheme = useReaderSettings((s) => s.setTheme);

  const nextId =
    THEME_IDS[(THEME_IDS.indexOf(theme) + 1) % THEME_IDS.length] ?? theme;
  const nextLabel = labelFor(nextId);

  return (
    <Button
      variant="quiet"
      size="sm"
      mono={mono}
      onClick={() => {
        // Persisted setting first, then the document — signed out, the store
        // write is a no-op and this still works as a local toggle.
        setStoreTheme(nextId as ReaderTheme);
        setTheme(nextId);
      }}
      aria-label={`Switch to ${nextLabel} theme`}
    >
      {nextLabel}
    </Button>
  );
}
