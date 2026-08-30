"use client";

import Link from "next/link";
import { THEMES, THEME_IDS } from "@/design/themes";
import { Button } from "@/components/primitives";
import type { ReaderTheme } from "@/store/reader-settings";

/**
 * ReaderTopBar — the reader's own top chrome (SPEC §8), replacing the app
 * NavBar in the reader route group. Layout mirrors the approved v0.1 `.bar`:
 * Library link + book meta · centred "LEAF" wordmark · theme toggle · "Aa".
 * Presentational + token-driven. Hidden (not unmounted) in immersive mode.
 */

export interface ReaderTopBarProps {
  title: string;
  author: string;
  theme: ReaderTheme;
  hidden: boolean;
  onSetTheme: (theme: ReaderTheme) => void;
  onOpenSettings: () => void;
  onOpenNotes: () => void;
  onEnterImmersive: () => void;
  highlightCount: number;
}

export function ReaderTopBar({
  title,
  author,
  theme,
  hidden,
  onSetTheme,
  onOpenSettings,
  onOpenNotes,
  onEnterImmersive,
  highlightCount,
}: ReaderTopBarProps) {
  const nextTheme: ReaderTheme =
    (THEME_IDS[(THEME_IDS.indexOf(theme) + 1) % THEME_IDS.length] as
      | ReaderTheme
      | undefined) ?? theme;
  const nextLabel = THEMES[nextTheme]?.label ?? nextTheme;

  return (
    <header
      className={
        "z-30 flex items-center justify-between transition-opacity " +
        "[transition-duration:var(--leaf-dur-ui)] " +
        "[padding-block:var(--leaf-reader-bar-pad-y)] " +
        "[padding-inline:var(--leaf-reader-bar-pad-x)] " +
        // Immersive: leave the flow so the page grows into this space.
        (hidden ? "absolute inset-x-0 top-0" : "flex-none")
      }
      style={{
        paddingTop: `calc(var(--leaf-reader-bar-pad-y) + var(--leaf-safe-top))`,
        paddingLeft: `calc(var(--leaf-reader-bar-pad-x) + var(--leaf-safe-left))`,
        paddingRight: `calc(var(--leaf-reader-bar-pad-x) + var(--leaf-safe-right))`,
        opacity: hidden ? 0 : 1,
      }}
      aria-hidden={hidden}
      inert={hidden}
    >
      <div className="flex flex-1 items-center gap-5">
        <Link
          href="/library"
          className="rounded-sm font-mono font-medium uppercase text-ink-mid transition-colors hover:text-ink [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-wide)] [transition-duration:var(--leaf-dur-ui)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
        >
          Library
        </Link>
        <span className="hidden font-mono uppercase text-faint [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-wide)] sm:inline">
          {title}
          {author ? ` · ${author}` : ""}
        </span>
      </div>

      <span
        aria-hidden
        className="hidden flex-none font-mono font-medium uppercase text-accent [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-eyebrow)] sm:block"
      >
        Leaf
      </span>

      <div className="flex flex-1 items-center justify-end gap-4">
        <Button
          variant="quiet"
          size="sm"
          mono
          onClick={() => onSetTheme(nextTheme)}
          aria-label={`Switch to ${nextLabel} theme`}
        >
          {nextLabel}
        </Button>
        <Button
          variant="quiet"
          size="sm"
          mono
          onClick={onOpenNotes}
          aria-label={`Highlights and notes (${highlightCount})`}
        >
          Notes{highlightCount > 0 ? ` ${highlightCount}` : ""}
        </Button>
        <Button
          variant="quiet"
          size="sm"
          mono
          onClick={onOpenSettings}
          aria-label="Reading settings"
        >
          Aa
        </Button>
        {/* Touch devices have no `F` key — this is the way into immersive. */}
        <Button
          variant="quiet"
          size="sm"
          onClick={onEnterImmersive}
          aria-label="Immersive reading"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </Button>
      </div>
    </header>
  );
}
