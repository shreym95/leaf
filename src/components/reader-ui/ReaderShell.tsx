"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  createReader,
  type ReaderController,
  type ReaderTocEntry,
} from "@/reader/engine";
import { trackPosition, type PositionTracker } from "@/reader/position";
import { useTheme } from "@/components/theme/ThemeProvider";
import {
  useReaderSettings,
  type ReaderTheme,
} from "@/store/reader-settings";
import { isThemeId } from "@/design/themes";
import { trackScreen } from "@/lib/analytics";
import {
  manageHighlights,
  type HighlightManager,
  type HighlightRecord,
} from "@/reader/highlights";
import {
  manageBookmarks,
  type BookmarkManager,
  type BookmarkRecord,
} from "@/reader/bookmarks";
import { highlightStyles } from "@/design/highlight-theme";
import { ReaderTopBar } from "./ReaderTopBar";
import { ReaderDock } from "./ReaderDock";
import { ReturnChip } from "./ReturnChip";
import { formatChapterLabel } from "./chapter-label";
import { SpreadFrame } from "./SpreadFrame";
import { ReaderDebugOverlay } from "./ReaderDebugOverlay";
import { useImmersive } from "./useImmersive";

/**
 * ReaderShell — the client reader (SPEC §8). Owns the epub.js container + the
 * engine / position-tracker lifecycle; everything visual is delegated to the
 * token-driven chrome components. The engine (`@/reader/engine`) and position
 * tracker (`@/reader/position`) are style-agnostic — this shell is the only
 * seam between them and the design layer.
 */

export interface ReaderShellInitialSettings {
  fontFamily: "serif" | "sans" | "legible";
  fontSize: number;
  lineSpacing: number;
  margins: "narrow" | "normal" | "wide";
  theme: ReaderTheme;
}

export interface ReaderShellProps {
  bookId: string;
  title: string;
  author: string;
  fileUrl: string;
  userId: string;
  initialSettings: ReaderShellInitialSettings;
  /** `?debug=1` only (see `./debug-flag`) — builds the engine's D2 probe and
   *  paints the readout. Off for every normal reader. */
  debug?: boolean;
}

type LoadState =
  | { state: "loading" }
  | { state: "ready" }
  | { state: "error"; message: string };

export function ReaderShell({
  bookId,
  title,
  author,
  fileUrl,
  userId,
  initialSettings,
  debug = false,
}: ReaderShellProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ReaderController | null>(null);
  const trackerRef = useRef<PositionTracker | null>(null);

  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [percent, setPercent] = useState(0);
  // Coarse progress for the polite live region — only whole 5% steps, so a
  // screen reader hears "N% read" roughly once per several pages, not on every
  // page turn (SPEC §3.6 screen-reader sanity: announce, don't chatter).
  const [announcedPct, setAnnouncedPct] = useState<number | null>(null);
  const [folio, setFolio] = useState<{
    left?: number;
    right?: number;
    total?: number;
  }>({});
  // The current chapter title (EPUB TOC) + the book's flattened TOC — both feed
  // the dock. `toc` is read once the book is open; `chapterLabel` refreshes on
  // every relocation.
  const [chapterLabel, setChapterLabel] = useState<string | null>(null);
  const [toc, setToc] = useState<ReaderTocEntry[]>([]);
  // Immersive is now Fullscreen-only — it drives the browser's own chrome away
  // (best-effort) and no longer hides Leaf's bars (see useImmersive). Bound to
  // `F`; the `[immersive]` effect below still asks epub.js to re-measure.
  const { immersive, exit: exitImmersive, toggle: toggleImmersive } =
    useImmersive();
  // The reader dock's expanded deck. Lifted here because a page turn and the
  // SpreadFrame centre-tap band both close/toggle it.
  const [deckOpen, setDeckOpen] = useState(false);

  // ── Highlights ────────────────────────────────────────────────────────
  // The manager still paints existing highlights into the book. There is no
  // list UI for them at the moment: highlight MODE is disabled pending a design
  // (REVISED_PLAN §4C), and the notes sheet that listed them went with the
  // reader's old chrome. The subscription is kept so the list can come back
  // without rewiring the engine.
  const highlightsRef = useRef<HighlightManager | null>(null);
  const [, setHighlights] = useState<HighlightRecord[]>([]);

  // ── Bookmarks (placeholder UI, stable schema — see NotesPanel header) ──
  const bookmarksRef = useRef<BookmarkManager | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  // The page currently on screen: its start CFI + progress, kept so the
  // bookmark toggle knows what to save and whether it is already saved. A ref
  // mirror lets the toggle callback stay identity-stable.
  const [here, setHere] = useState<{ cfi?: string; percent: number }>({
    percent: 0,
  });
  const hereRef = useRef(here);
  useEffect(() => {
    hereRef.current = here;
  }, [here]);

  const { setTheme: applyChromeTheme } = useTheme();

  // Live settings from the store (hydrated below).
  const settings = useReaderSettings(
    useShallow((s) => ({
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineSpacing: s.lineSpacing,
      margins: s.margins,
      theme: s.theme,
    })),
  );
  const setStoreTheme = useReaderSettings((s) => s.setTheme);

  // The highlight manager is created once but must paint with the CURRENT
  // theme's wash, so its closure reads this ref rather than a captured value.
  const themeRef = useRef(initialSettings.theme);
  useEffect(() => {
    themeRef.current = settings.theme;
  }, [settings.theme]);

  // ── Hydrate the store once from the server-loaded row ──────────────────
  // (createReader is seeded straight from the `initialSettings` prop, so the
  // one-render gap before this effect runs is harmless.)
  useEffect(() => {
    useReaderSettings.getState().hydrate(initialSettings, userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Screen view (SPEC §9 M4) — name only, no bookId/title/CFI ──────────
  useEffect(() => {
    trackScreen("reader");
  }, []);

  // ── Book identity lives in the browser tab now, not in a reader top bar
  //    (design iteration 1 slimmed the bar to Library + wordmark). ──────────
  useEffect(() => {
    const previous = document.title;
    document.title = [title, author].filter(Boolean).join(" — ") || "Leaf";
    return () => {
      document.title = previous;
    };
  }, [title, author]);

  // ── Theme is single-source: the reader-settings store. The toggle writes
  //    only the store; this effect propagates it to the app chrome
  //    (`<html data-theme>`) and, via the [settings] effect below, to the book. ─
  useEffect(() => {
    if (isThemeId(settings.theme)) applyChromeTheme(settings.theme);
  }, [settings.theme, applyChromeTheme]);

  const setReaderTheme = useCallback(
    (theme: ReaderTheme) => setStoreTheme(theme),
    [setStoreTheme],
  );

  // ── Engine + position-tracker lifecycle ───────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let unsubRelocated: (() => void) | undefined;
    let unsubSelected: (() => void) | undefined;
    let unsubHighlights: (() => void) | undefined;
    let unsubBookmarks: (() => void) | undefined;

    (async () => {
      try {
        const res = await fetch(fileUrl);
        if (!res.ok) {
          throw new Error(`Couldn't download the book (HTTP ${res.status}).`);
        }
        const bytes = await res.arrayBuffer();
        if (cancelled) return;

        // `bookId` keys the locations cache so progress is exact on reopen
        // instead of climbing from 0 while the table regenerates (D7).
        const controller = await createReader(bytes, initialSettings, {
          debug,
          bookId,
        });
        if (cancelled || !viewerRef.current) {
          controller.destroy();
          return;
        }
        controllerRef.current = controller;

        unsubRelocated = controller.onRelocated((loc) => {
          if (cancelled) return;
          setPercent(loc.percent);
          setHere({ cfi: loc.cfi, percent: loc.percent });
          // A two-page spread shows facing pages, so the right folio is the
          // next page — not the section's page count. It read "3 … 10" on
          // desktop, which is a page number beside a total. SpreadFrame hides
          // the right folio below the spread breakpoint.
          setFolio({
            left: loc.displayedPage,
            right:
              loc.displayedPage != null ? loc.displayedPage + 1 : undefined,
            total: loc.totalPages,
          });
          setChapterLabel(controller.currentChapterLabel() ?? null);
          const p = Math.round(loc.percent * 100);
          setAnnouncedPct((prev) =>
            prev === null || Math.abs(p - prev) >= 5 ? p : prev,
          );
        });

        await controller.attach(viewerRef.current);
        if (cancelled) {
          controller.destroy();
          return;
        }

        const tracker = trackPosition(controller, bookId);
        trackerRef.current = tracker;
        await tracker.restore();

        // The book is open — read its table of contents for the dock's `≡`
        // popover. Style-agnostic data from the engine; empty when the EPUB
        // ships no navigation document.
        if (!cancelled) {
          setToc(controller.toc());
          setChapterLabel(controller.currentChapterLabel() ?? null);
        }

        // Highlights: the manager is style-agnostic, so the concrete wash comes
        // from the design layer here. `themeRef` keeps the closure reading the
        // live theme rather than the value captured at mount.
        const highlights = manageHighlights(controller, bookId, {
          stylesFor: (color) => highlightStyles(color, themeRef.current),
        });
        highlightsRef.current = highlights;
        unsubHighlights = highlights.subscribe(setHighlights);
        await highlights.restore();

        // Bookmarks: no rendition painting (the visible treatment is a later
        // design decision) — just load the list and keep it in sync.
        const bookmarks = manageBookmarks(bookId);
        bookmarksRef.current = bookmarks;
        unsubBookmarks = bookmarks.subscribe(setBookmarks);
        await bookmarks.restore();

        // NOTE: the selection-triggered highlight popover is DISABLED.
        // It opened on any text selection, sat over the page, and had no way to
        // dismiss itself — on a phone, where selection is easy to trigger by
        // accident, it was unusable. Existing highlights still render, and the
        // notes panel still reads, annotates and deletes them. Creating a
        // highlight needs a touch-first design first — see docs/BACKLOG.md.
        // Re-enable by restoring `controller.onSelected(...)` here.

        if (!cancelled) setLoad({ state: "ready" });
      } catch (err) {
        if (cancelled) return;
        setLoad({
          state: "error",
          message:
            err instanceof Error
              ? err.message
              : "This book could not be opened.",
        });
      }
    })();

    return () => {
      cancelled = true;
      unsubRelocated?.();
      unsubSelected?.();
      unsubHighlights?.();
      unsubBookmarks?.();
      highlightsRef.current?.stop();
      highlightsRef.current = null;
      bookmarksRef.current?.stop();
      bookmarksRef.current = null;
      trackerRef.current?.stop();
      trackerRef.current = null;
      controllerRef.current?.destroy();
      controllerRef.current = null;
      useReaderSettings.getState().flush();
    };
    // initialSettings is a fresh object each render but only seeds createReader
    // once; keying on the stable fileUrl/bookId is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, bookId]);

  // ── Push live settings changes into the rendition ─────────────────────
  // `settings` keeps a stable identity (useShallow) until a value changes.
  useEffect(() => {
    controllerRef.current?.applySettings(settings);
  }, [settings]);

  // ── Immersive changes the page's height (the bars leave the flow), and
  //    epub.js caches its container size — make it re-measure. ─────────────
  useEffect(() => {
    controllerRef.current?.relayout();
  }, [immersive]);

  // ── Resize → let epub.js recompute the spread ─────────────────────────
  useEffect(() => {
    const onResize = () => controllerRef.current?.relayout();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [returnTo, setReturnTo] = useState<{
    cfi: string;
    label: string | null;
  } | null>(null);
  // Turns since the jump. The chip is not on a timer: a reader who jumps to
  // check something often reads a page or two there, and a timeout would pull
  // the rope away exactly when it is still wanted. Eight turns is "you are
  // reading here now, not visiting".
  const turnsSinceJump = useRef(0);

  // ── Page turn — instant (epub.js swaps content itself) ────────────────
  // `source` names the control that fired it; the engine only records it in the
  // debug turn log (DEFECTS.md D2) and ignores it otherwise.
  const turn = useCallback((dir: "next" | "prev", source: string) => {
    const controller = controllerRef.current;
    if (!controller) return;
    turnsSinceJump.current += 1;
    if (turnsSinceJump.current > 8) setReturnTo(null);
    void (dir === "next" ? controller.next(source) : controller.prev(source));
  }, []);

  // A page turn from OUTSIDE the deck (tap zones, arrow keys) collapses it —
  // "closes on … a page turn". The deck's own `‹` / `›` call `turn` directly so
  // a keyboard user can page through with the deck up (decision 2).
  const turnAndCloseDeck = useCallback(
    (dir: "next" | "prev", source: string) => {
      turn(dir, source);
      setDeckOpen(false);
    },
    [turn],
  );

  // ── Jump-back ─────────────────────────────────────────────────────────
  // Every non-linear move is destructive: tap a chapter or a bookmark and the
  // place you were holding is gone. Print does not have this problem — your
  // thumb stays in the page — and Kindle's Page Flip solves it by pinning the
  // page you left. This is that, reduced to one control: remember where the
  // jump started, offer a chip back, and clear it once the reader has clearly
  // moved on.
  const jumpTo = useCallback(
    (target: string) => {
      const from = hereRef.current.cfi;
      if (from) {
        setReturnTo({ cfi: from, label: formatChapterLabel(chapterLabel) });
        turnsSinceJump.current = 0;
      }
      void controllerRef.current?.goTo(target);
    },
    [chapterLabel],
  );

  const returnFromJump = useCallback(() => {
    const back = returnTo;
    if (!back) return;
    setReturnTo(null);
    void controllerRef.current?.goTo(back.cfi);
  }, [returnTo]);

  // ── Bookmark / un-bookmark the page on screen ─────────────────────────
  // Placeholder control (see NotesPanel header). Matches the current page by
  // exact start-CFI — good enough for a plain toggle; a redesign can make the
  // match fuzzier if it needs to.
  const toggleBookmark = useCallback(() => {
    const mgr = bookmarksRef.current;
    const cfi = hereRef.current.cfi;
    if (!mgr || !cfi) return;
    const existing = mgr.list().find((b) => b.cfi === cfi);
    if (existing) {
      void mgr.remove(existing.id);
    } else {
      void mgr.create({
        cfi,
        label: controllerRef.current?.currentChapterLabel() ?? null,
        percent: hereRef.current.percent,
      });
    }
  }, []);

  // ── Debug readout accessors — stable identities so the overlay's
  //    subscription effect doesn't re-run on every render. ─────────────────
  const debugSnapshot = useCallback(
    () => controllerRef.current?.debugSnapshot?.() ?? null,
    [],
  );
  const debugSubscribe = useCallback(
    (cb: () => void) => controllerRef.current?.onDebug?.(cb) ?? null,
    [],
  );

  // ── Keyboard (SPEC §3.6): ←/→ pages · F immersive · Esc exits ─────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const key = e.key.toLowerCase();

      if (e.key === "Escape") {
        if (deckOpen) return; // ReaderDock owns Esc while the deck is open
        if (immersive) exitImmersive();
        return;
      }

      if (e.key === "ArrowRight") {
        turnAndCloseDeck("next", "key-right");
      } else if (e.key === "ArrowLeft") {
        turnAndCloseDeck("prev", "key-left");
      } else if (key === "f") {
        toggleImmersive();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    turnAndCloseDeck,
    immersive,
    deckOpen,
    exitImmersive,
    toggleImmersive,
  ]);

  return (
    <>
      <ReaderTopBar
        immersive={immersive}
        // Fullscreen gives the page the browser's chrome; keeping ours would
        // hand the space straight back. Opening the deck brings it back, so the
        // fullscreen toggle and the way to the library are never unreachable.
        hidden={immersive && !deckOpen}
        onToggleImmersive={toggleImmersive}
      />

      <SpreadFrame
        viewerRef={viewerRef}
        frameRef={frameRef}
        loading={load.state === "loading"}
        folioLeft={folio.left}
        folioRight={folio.right}
        onPrev={() => turnAndCloseDeck("prev", "tap-prev")}
        onNext={() => turnAndCloseDeck("next", "tap-next")}
      >
        {returnTo && (
          <ReturnChip label={returnTo.label} onReturn={returnFromJump} />
        )}

        {load.state === "error" && (
          <p
            role="alert"
            className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center font-ui text-accent [font-size:var(--leaf-text-sm)]"
          >
            {load.message}
          </p>
        )}
      </SpreadFrame>

      <ReaderDock
        open={deckOpen}
        onOpenChange={setDeckOpen}
        percent={percent}
        chapterLabel={chapterLabel}
        toc={toc}
        onNavigate={(href) => jumpTo(href)}
        onPrevPage={() => turn("prev", "dock-prev")}
        onNextPage={() => turn("next", "dock-next")}
        theme={settings.theme}
        onSetTheme={setReaderTheme}
        fontSize={settings.fontSize}
        onSetFontSize={(size) => useReaderSettings.getState().setFontSize(size)}
        bookmarked={
          here.cfi != null && bookmarks.some((b) => b.cfi === here.cfi)
        }
        canBookmark={Boolean(here.cfi)}
        onToggleBookmark={toggleBookmark}
        bookmarks={bookmarks.map((b) => ({
          id: b.id,
          cfi: b.cfi,
          label: b.label,
          percent: b.percent,
        }))}
        onGoToBookmark={(cfi) => {
          setDeckOpen(false);
          jumpTo(cfi);
        }}
        onRemoveBookmark={(id) => void bookmarksRef.current?.remove(id)}
      />


      {debug && (
        <ReaderDebugOverlay
          snapshot={debugSnapshot}
          subscribe={debugSubscribe}
        />
      )}

      {/* Polite, throttled progress announcement for screen readers. Updated
          only on 5% boundaries (see `announcedPct`) so it never chatters. */}
      <p role="status" aria-live="polite" className="sr-only">
        {load.state === "ready" && announcedPct != null
          ? `${announcedPct}% read`
          : ""}
      </p>
    </>
  );
}
