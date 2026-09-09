"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { THEME_IDS, THEMES } from "@/design/themes";
import type { ReaderTheme } from "@/store/reader-settings";
import type { ReaderTocEntry } from "@/reader/engine";
import { TocPopover, type DockBookmark } from "./TocPopover";
import { formatChapterLabel } from "./chapter-label";

/**
 * ReaderDock — the reader's bottom chrome (design iteration 1, REVISED_PLAN §9B
 * requirement 2). Replaces the old `ReaderBottomBar`. Two states in one bottom
 * safe zone:
 *
 *  A. Resting pill — chapter badge · hairline progress · percent · settings
 *     hint. One button; tapping it opens B.
 *  B. Expanded deck — Tier 1: `‹` / progress island / `›`. Tier 2: theme
 *     toggle · font stepper · contents popover · settings · close.
 *
 * Closes on ✕, Esc, a tap outside the deck, or a page turn (the last is driven
 * by `ReaderShell` flipping `open` back to false).
 *
 * Presentational + token-driven. The engine reference and the settings store
 * both stay in `ReaderShell`; this component only renders and calls back.
 *
 * ── Couplings a future redesign should know about ──────────────────────────
 *  - The progress island's track is a static `progressbar` this stage.
 *    Drag-to-seek (stage 4) attaches to the element marked `STAGE 4 SEAM`
 *    below — swap `role`, add `aria-valuenow` + pointer handlers there; the
 *    groove/fill geometry is already a slider's.
 *  - The theme toggle assumes exactly two registered themes: it slides between
 *    `THEME_IDS[0]` and `THEME_IDS[THEME_IDS.length - 1]`. A third theme makes
 *    it lossy — it would need to become a picker again (see the retired
 *    `ReaderSettingsSheet` "Theme" segmented control for the pattern).
 *  - The font stepper writes a *continuous* `reader_settings.fontSize`
 *    (0.9–1.45, step 0.06). The settings sheet's S/M/L snaps the same value to
 *    three presets, so a value set here shows rounded there and vice versa.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Continuous font-size bounds for the `A− / A+` stepper (rem). */
const FONT_MIN = 0.9;
const FONT_MAX = 1.45;
const FONT_STEP = 0.06;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface ReaderDockProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 0–1 through the book. */
  percent: number;
  /** Current chapter title from the EPUB TOC, or null. */
  chapterLabel: string | null;
  /** Page within the current section, if epub.js reports one. */
  /** The book's flattened table of contents (`ReaderController.toc()`). */
  toc: ReaderTocEntry[];
  /** Navigate to a TOC entry's href. */
  onNavigate: (href: string) => void;
  /** Turn the page WITHOUT closing the deck — the deck's own `‹` / `›`. */
  onPrevPage: () => void;
  onNextPage: () => void;
  theme: ReaderTheme;
  onSetTheme: (theme: ReaderTheme) => void;
  fontSize: number;
  onSetFontSize: (size: number) => void;
  /** Open the shared `ReaderSettingsSheet`. */
  /** Whether the current page is already bookmarked. */
  bookmarked: boolean;
  /** Saved bookmarks for this book — listed in the contents panel. */
  bookmarks: DockBookmark[];
  onGoToBookmark: (cfi: string) => void;
  onRemoveBookmark: (id: string) => void;
  /** Disabled until the engine reports a position to bookmark. */
  canBookmark: boolean;
  onToggleBookmark: () => void;
}

// ── Icons — flat vector line SVGs, no emoji (handoff §4) ──────────────────

const svgBase = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function ChevronLeft() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" {...svgBase}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" {...svgBase}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
function ContentsIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-[var(--leaf-dock-icon)] w-[var(--leaf-dock-icon)]" {...svgBase}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-[var(--leaf-dock-icon)] w-[var(--leaf-dock-icon)]" {...svgBase}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-[var(--leaf-dock-icon)] w-[var(--leaf-dock-icon)]" {...svgBase}>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-[var(--leaf-dock-icon)] w-[var(--leaf-dock-icon)]"
      {...svgBase}
      fill={filled ? "currentColor" : "none"}
    >
      <path d="M6 3h12v18l-6-4.5L6 21V3z" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-[calc(var(--leaf-dock-icon)-2px)] w-[calc(var(--leaf-dock-icon)-2px)]" {...svgBase}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-[calc(var(--leaf-dock-icon)-2px)] w-[calc(var(--leaf-dock-icon)-2px)]" {...svgBase}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </svg>
  );
}


// ── Shared pod surface ───────────────────────────────────────────────────

const podSurface: CSSProperties = {
  background: "var(--leaf-dock-bg)",
  borderColor: "var(--leaf-dock-border)",
  color: "var(--leaf-dock-text)",
  boxShadow: "var(--leaf-shadow-sheet)",
};

const podClass =
  "flex flex-none items-center justify-center border outline-none " +
  "[transition:background_var(--leaf-dur-ui)_var(--leaf-ease),transform_var(--leaf-dur-ui)_var(--leaf-ease)] " +
  "focus-visible:[box-shadow:var(--leaf-shadow-focus)] " +
  "disabled:opacity-40 disabled:pointer-events-none";

// ── Sub-components ───────────────────────────────────────────────────────


function ThemeToggle({
  theme,
  onSetTheme,
}: {
  theme: ReaderTheme;
  onSetTheme: (theme: ReaderTheme) => void;
}) {
  // Registry-driven, never a hard-coded pair: slide between the first and last
  // registered theme (exactly two today — see the file header note).
  const firstId = THEME_IDS[0];
  const lastId = THEME_IDS[THEME_IDS.length - 1];
  const checked = theme === lastId;
  const target = checked ? firstId : lastId;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${THEMES[lastId].label} theme`}
      onClick={() => onSetTheme(target)}
      className={`${podClass} relative rounded-pill`}
      style={{
        ...podSurface,
        width: "var(--leaf-dock-theme-w)",
        height: "var(--leaf-dock-pod-size)",
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-between px-[var(--leaf-space-2)]"
      >
        <span
          style={{
            color: checked
              ? "var(--leaf-dock-text-muted)"
              : "var(--leaf-dock-text)",
          }}
        >
          <SunIcon />
        </span>
        <span
          style={{
            color: checked
              ? "var(--leaf-dock-text)"
              : "var(--leaf-dock-text-muted)",
          }}
        >
          <MoonIcon />
        </span>
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-pill [transition:transform_var(--leaf-dur-ui)_var(--leaf-ease)]"
        style={{
          top: "50%",
          left: "var(--leaf-space-1)",
          height: "calc(var(--leaf-dock-pod-size) - var(--leaf-space-1) * 2)",
          width: "calc(var(--leaf-dock-pod-size) - var(--leaf-space-1) * 2)",
          background: "var(--leaf-dock-text)",
          transform: checked
            ? "translateY(-50%) translateX(calc(var(--leaf-dock-theme-w) - var(--leaf-dock-pod-size)))"
            : "translateY(-50%)",
        }}
      />
    </button>
  );
}

function FontStepper({
  fontSize,
  onSetFontSize,
}: {
  fontSize: number;
  onSetFontSize: (size: number) => void;
}) {
  const step = (dir: 1 | -1) =>
    onSetFontSize(clamp(round2(fontSize + dir * FONT_STEP), FONT_MIN, FONT_MAX));

  const btn =
    "px-[var(--leaf-space-3)] font-ui font-medium [font-size:var(--leaf-text-xs)] " +
    "outline-none opacity-80 hover:opacity-100 " +
    "[transition:opacity_var(--leaf-dur-ui)_var(--leaf-ease)] " +
    "focus-visible:[box-shadow:var(--leaf-shadow-focus)] " +
    "disabled:opacity-30 disabled:pointer-events-none";

  return (
    <div
      role="group"
      aria-label="Text size"
      className="flex flex-none items-center rounded-pill border"
      style={{ ...podSurface, height: "var(--leaf-dock-pod-size)" }}
    >
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={fontSize <= FONT_MIN + 1e-6}
        aria-label="Decrease text size"
        className={`${btn} rounded-l-pill`}
      >
        A&#8722;
      </button>
      <span
        aria-hidden
        className="h-3 w-px flex-none"
        style={{ background: "var(--leaf-dock-border)" }}
      />
      <button
        type="button"
        onClick={() => step(1)}
        disabled={fontSize >= FONT_MAX - 1e-6}
        aria-label="Increase text size"
        className={`${btn} rounded-r-pill`}
      >
        A+
      </button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────

export function ReaderDock({
  open,
  onOpenChange,
  percent,
  chapterLabel,
  toc,
  onNavigate,
  onPrevPage,
  onNextPage,
  theme,
  onSetTheme,
  fontSize,
  onSetFontSize,
  bookmarked,
  bookmarks,
  onGoToBookmark,
  onRemoveBookmark,
  canBookmark,
  onToggleBookmark,
}: ReaderDockProps) {
  const pct = Math.round(clamp(percent, 0, 1) * 100);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const tocWrapRef = useRef<HTMLDivElement>(null);
  const tocTriggerRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);
  const prevOpenForFocus = useRef(open);
  // Set by an in-deck close (✕ / Esc / outside-tap) so focus returns to the
  // pill; left false for a page-turn close (focus is already elsewhere).
  const reclaimFocus = useRef(false);
  const tocId = useId();

  const [tocOpen, setTocOpen] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  // Deck closed (or is closing) → its TOC popover must not linger, and must not
  // reappear when the deck is next opened. Render-phase reset — the sanctioned
  // "adjust state when a prop changes" pattern, no effect needed.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open && tocOpen) setTocOpen(false);
  }
  const tocShown = open && tocOpen;

  // Focus management across the open⇄close transition. Runs after commit, so
  // the target is no longer `inert` by the time we focus it.
  useEffect(() => {
    const was = prevOpenForFocus.current;
    prevOpenForFocus.current = open;
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (open && !was) {
      // Opened by a tap or Enter on the pill, which is now `inert` — move in.
      deckRef.current?.focus();
    } else if (!open && was && reclaimFocus.current) {
      reclaimFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  const closeDeck = useCallback(() => {
    reclaimFocus.current = true;
    onOpenChange(false);
  }, [onOpenChange]);

  const closeToc = useCallback(() => {
    setTocOpen(false);
    tocTriggerRef.current?.focus();
  }, []);

  const navigateToc = useCallback(
    (href: string) => {
      setTocOpen(false);
      reclaimFocus.current = true; // land on the pill after the jump
      onOpenChange(false);
      onNavigate(href);
    },
    [onOpenChange, onNavigate],
  );

  // Esc + outside-tap, only while open. Esc closes the TOC first, then the deck.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (tocShown) closeToc();
      else closeDeck();
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!deckRef.current?.contains(target)) {
        closeDeck();
        return;
      }
      if (tocShown && !tocWrapRef.current?.contains(target)) {
        setTocOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, tocShown, closeDeck, closeToc]);

  return (
    <div
      className="pointer-events-none relative z-30 flex flex-none items-end justify-center px-[var(--leaf-reader-bar-pad-x)]"
      style={{
        height:
          "calc(var(--leaf-dock-h) + var(--leaf-dock-bottom) + var(--leaf-reader-bar-pad-y))",
      }}
    >
      {/* ── State A — resting dock ───────────────────────────────────────── */}
      {/* Two objects, not one. The pill is a STATUS readout and is not
          clickable: making the whole thing a button meant every stray tap near
          the bottom of the page opened the deck. The deck now has exactly one
          trigger — the settings button beside it — which is small and
          deliberate (founder, 2026-09-09). */}
      <div
        inert={open}
        aria-hidden={open}
        className="pointer-events-auto absolute left-1/2 flex -translate-x-1/2 items-center gap-[var(--leaf-dock-gap)] [transition:opacity_var(--leaf-dur-ui)_var(--leaf-ease)]"
        style={{
          bottom: "var(--leaf-dock-bottom)",
          opacity: open ? 0 : 1,
        }}
      >
        {/* ONE surface. The handoff's §1 and §4 both hang on this: the resting
            dock and the expanded pods are the same solid material, so it never
            looks like a row of loose chips. Every child here is transparent. */}
        <div
          aria-hidden
          className="flex items-center gap-[var(--leaf-space-3)] border px-[var(--leaf-dock-pad-x)]"
          style={{
            ...podSurface,
            height: "var(--leaf-dock-h)",
            borderRadius: "var(--leaf-dock-radius)",
          }}
        >
          <span
            className="max-w-[11ch] truncate font-mono [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-tight)]"
            style={{ color: "var(--leaf-dock-text-muted)" }}
          >
            {formatChapterLabel(chapterLabel) ?? "Reading"}
          </span>

          <span
            className="relative overflow-hidden rounded-pill"
            style={{
              width: "var(--leaf-dock-progress-w)",
              height: "var(--leaf-dock-track-h)",
              background: "var(--leaf-dock-track)",
            }}
          >
            <span
              className="absolute inset-y-0 left-0 rounded-pill [transition:width_var(--leaf-dur-ui)_var(--leaf-ease)]"
              style={{ width: `${pct}%`, background: "var(--leaf-dock-text)" }}
            />
          </span>

          <span
            className="font-mono tabular-nums [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-tight)]"
            style={{ color: "var(--leaf-dock-text)" }}
          >
            {pct}%
          </span>
        </div>

        <button
          ref={triggerRef}
          type="button"
          onClick={() => onOpenChange(true)}
          aria-label={
            `Open reading controls — ${pct}% read` +
            (chapterLabel ? `, ${formatChapterLabel(chapterLabel)}` : "")
          }
          className={`${podClass} rounded-pill hover:[background:var(--leaf-dock-hover)] active:scale-95`}
          style={{
            ...podSurface,
            width: "var(--leaf-dock-h)",
            height: "var(--leaf-dock-h)",
          }}
        >
          <SettingsIcon />
        </button>
      </div>

      {/* ── State B — expanded two-tier deck ─────────────────────────────── */}
      <div
        ref={deckRef}
        role="region"
        aria-label="Reading controls"
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        className="pointer-events-auto absolute left-1/2 flex flex-col gap-[var(--leaf-dock-deck-gap)] outline-none [transition:opacity_var(--leaf-dur-ui)_var(--leaf-ease),transform_var(--leaf-dur-ui)_var(--leaf-ease)]"
        style={{
          bottom: "var(--leaf-dock-bottom)",
          width:
            "min(var(--leaf-dock-deck-max-w), calc(100vw - var(--leaf-space-5) * 2))",
          opacity: open ? 1 : 0,
          transform: open
            ? "translate(-50%, 0)"
            : "translate(-50%, var(--leaf-space-2))",
        }}
      >
        {/* ONE row. There is deliberately no progress tier above the pods:
            it repeated the resting pill's chapter, bar and percent on a second,
            heavier surface, and reading it as a swap (pill out, island in) is
            what made the open deck feel bulky (founder, 2026-09-09). Progress
            lives in the resting pill and nowhere else.

            `‹` and `›` are screen-reader-only below `lg`. They exist for
            assistive tech and switch access — the page-turn tap zones are
            `tabIndex={-1}` by design and keyboards already have ←/→ — so
            hiding them visually on a phone costs nothing and buys the ~90px the
            row needs to fit at 390px. On desktop there is room, so they show. */}
        <div className="flex items-center justify-center gap-[var(--leaf-dock-deck-gap)]">
          <button
            type="button"
            onClick={onPrevPage}
            aria-label="Previous page"
            className={`${podClass} sr-only rounded-pill hover:[background:var(--leaf-dock-hover)] active:scale-95 lg:not-sr-only lg:flex`}
            style={{
              ...podSurface,
              width: "var(--leaf-dock-pod-size)",
              height: "var(--leaf-dock-pod-size)",
            }}
          >
            <ChevronLeft />
          </button>

          <ThemeToggle theme={theme} onSetTheme={onSetTheme} />

          <FontStepper fontSize={fontSize} onSetFontSize={onSetFontSize} />

          <div ref={tocWrapRef} className="relative flex-none">
            <button
              ref={tocTriggerRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={tocShown}
              aria-controls={tocId}
              aria-label="Table of contents"
              onClick={() => setTocOpen((v) => !v)}
              className={`${podClass} rounded-pill hover:[background:var(--leaf-dock-hover)] active:scale-95`}
              style={{
                ...podSurface,
                width: "var(--leaf-dock-pod-size)",
                height: "var(--leaf-dock-pod-size)",
              }}
            >
              <ContentsIcon />
            </button>

            <TocPopover
              id={tocId}
              open={tocShown}
              entries={toc}
              currentLabel={chapterLabel}
              onNavigate={navigateToc}
              bookmarks={bookmarks}
              onGoToBookmark={(cfi) => {
                setTocOpen(false);
                onGoToBookmark(cfi);
              }}
              onRemoveBookmark={onRemoveBookmark}
            />
          </div>

          {/* Bookmarking lives here now. It used to be a tab on the frame's
              top edge, which spent reading space on a control used a few times
              a book. The list of bookmarks is a tab in the contents panel. */}
          <button
            type="button"
            onClick={onToggleBookmark}
            disabled={!canBookmark}
            aria-pressed={bookmarked}
            aria-label={
              bookmarked
                ? "Remove bookmark from this page"
                : "Bookmark this page"
            }
            className={`${podClass} rounded-pill hover:[background:var(--leaf-dock-hover)] active:scale-95`}
            style={{
              ...podSurface,
              width: "var(--leaf-dock-pod-size)",
              height: "var(--leaf-dock-pod-size)",
            }}
          >
            <BookmarkIcon filled={bookmarked} />
          </button>

          <button
            type="button"
            onClick={onNextPage}
            aria-label="Next page"
            className={`${podClass} sr-only rounded-pill hover:[background:var(--leaf-dock-hover)] active:scale-95 lg:not-sr-only lg:flex`}
            style={{
              ...podSurface,
              width: "var(--leaf-dock-pod-size)",
              height: "var(--leaf-dock-pod-size)",
            }}
          >
            <ChevronRight />
          </button>

          <button
            type="button"
            onClick={closeDeck}
            aria-label="Close reading controls"
            className={`${podClass} rounded-pill hover:[background:var(--leaf-dock-hover)] active:scale-95`}
            style={{
              ...podSurface,
              width: "var(--leaf-dock-pod-size)",
              height: "var(--leaf-dock-pod-size)",
            }}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
