"use client";

import { THEMES, THEME_IDS, type ThemeId } from "@/design/themes";
import { Button } from "@/components/primitives/Button";
import { useTheme } from "./ThemeProvider";

/**
 * ThemeToggle — a Button that cycles the theme. Its label names the NEXT theme
 * (shows "Day" while in night), matching the approved v0.1 bar behaviour.
 */

function labelFor(id: ThemeId): string {
  return THEMES[id]?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function ThemeToggle({ mono = true }: { mono?: boolean }) {
  const { theme, toggle } = useTheme();

  const nextId =
    THEME_IDS[(THEME_IDS.indexOf(theme) + 1) % THEME_IDS.length] ?? theme;
  const nextLabel = labelFor(nextId);

  return (
    <Button
      variant="quiet"
      size="sm"
      mono={mono}
      onClick={toggle}
      aria-label={`Switch to ${nextLabel} theme`}
    >
      {nextLabel}
    </Button>
  );
}
