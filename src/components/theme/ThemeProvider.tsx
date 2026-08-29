"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  THEME_IDS,
  DEFAULT_THEME,
  isThemeId,
  type ThemeId,
} from "@/design/themes";

/**
 * ThemeProvider — owns the active theme. Setting a theme = write `data-theme`
 * on <html> + persist to localStorage; the CSS custom properties in tokens.css
 * cascade from there. No styling lives here.
 *
 * The source of truth is the `<html data-theme>` attribute, which a pre-paint
 * inline script in layout.tsx sets before React runs (no flash). This provider
 * reads it via useSyncExternalStore — no effects, no hydration mismatch (the
 * server snapshot is DEFAULT_THEME, matching the script's fallback).
 *
 * Persistence is localStorage for M0; it moves to `profiles.default_theme` in M1.
 */

const STORAGE_KEY = "leaf-theme";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Cross-tab: another tab wrote the preference.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): ThemeId {
  const attr = document.documentElement.dataset.theme;
  if (isThemeId(attr)) return attr;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    /* storage blocked */
  }
  return DEFAULT_THEME;
}

function getServerSnapshot(): ThemeId {
  return DEFAULT_THEME;
}

function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage unavailable — theme still applies for this session */
  }
  listeners.forEach((l) => l());
}

export interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((id: ThemeId) => applyTheme(id), []);

  const toggle = useCallback(() => {
    const idx = THEME_IDS.indexOf(getSnapshot());
    applyTheme(THEME_IDS[(idx + 1) % THEME_IDS.length] ?? DEFAULT_THEME);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggle }),
    [theme, setTheme, toggle],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme() must be used within <ThemeProvider>");
  }
  return ctx;
}
