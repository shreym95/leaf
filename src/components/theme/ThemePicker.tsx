"use client";

import { useRef } from "react";
import clsx from "clsx";
import { THEMES, THEME_IDS, type ThemeId } from "@/design/themes";
import { useReaderSettings, type ReaderTheme } from "@/store/reader-settings";
import { useTheme } from "./ThemeProvider";

/**
 * ThemePicker — a segmented control that shows EVERY registered theme at once,
 * marks the current one, and switches to any of them in a single tap. It
 * replaces the old cycling `ThemeToggle`, whose label named only the *next*
 * theme — fine at two, a guessing game at three (Day → Sepia → Night → Day).
 *
 * Driven entirely off the theme registry (`THEME_IDS` / `THEMES`), so it renders
 * correctly whether the registry holds two themes or twenty — never hardcode a
 * list or a count here.
 *
 * A11y: WAI-ARIA "radio group" pattern (APG), matching the `Segmented` control
 * in ReaderSettingsSheet — the group is one Tab stop, Arrow / Home / End move
 * between options and select as they go (roving tabindex), focus ring via
 * `--leaf-shadow-focus`.
 *
 * Theme is ONE persisted setting shared by the app chrome and the reader. Like
 * the old toggle, this writes the reader-settings store FIRST, then the
 * document: writing only `useTheme().setTheme` touches localStorage alone and
 * the database value wins on the next page load — the founder's "I switched to
 * Night in a book, went back to the library, it flipped to Day" bug. Signed
 * out, the store write is a no-op and this still works as a local toggle — no
 * auth check, by design.
 */

export function ThemePicker({ mono = true }: { mono?: boolean }) {
  const { theme, setTheme } = useTheme();
  const setStoreTheme = useReaderSettings((s) => s.setTheme);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const foundIndex = THEME_IDS.indexOf(theme);
  const activeIndex = foundIndex === -1 ? 0 : foundIndex;

  function choose(id: ThemeId) {
    // Persisted setting first, then the document. Keep both calls and this
    // order — see the component doc-comment.
    setStoreTheme(id as ReaderTheme);
    setTheme(id);
  }

  function selectAt(i: number) {
    const n = THEME_IDS.length;
    const idx = ((i % n) + n) % n;
    const id = THEME_IDS[idx];
    if (!id) return;
    choose(id);
    btnRefs.current[idx]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        selectAt(activeIndex + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        selectAt(activeIndex - 1);
        break;
      case "Home":
        e.preventDefault();
        selectAt(0);
        break;
      case "End":
        e.preventDefault();
        selectAt(THEME_IDS.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={onKeyDown}
      className="inline-flex gap-1 rounded-sm border border-rule p-1"
    >
      {THEME_IDS.map((id, i) => {
        const active = id === theme;
        return (
          <button
            key={id}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === activeIndex ? 0 : -1}
            onClick={() => choose(id)}
            className={clsx(
              "rounded-xs px-2 py-1 font-ui transition-colors select-none",
              "[font-size:var(--leaf-text-2xs)] [transition-duration:var(--leaf-dur-ui)]",
              "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]",
              mono &&
                "font-mono font-medium uppercase [letter-spacing:var(--leaf-tracking-wide)]",
              active
                ? "[background:var(--leaf-accent)] [color:var(--leaf-page)]"
                : "text-ink-mid hover:text-ink",
            )}
          >
            {THEMES[id].label}
          </button>
        );
      })}
    </div>
  );
}
