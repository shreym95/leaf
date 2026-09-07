"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { createReader, type ReaderController } from "@/reader/engine";
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
import { highlightStyles } from "@/design/highlight-theme";
import { ReaderTopBar } from "./ReaderTopBar";
import { ReaderBottomBar } from "./ReaderBottomBar";
import { SpreadFrame } from "./SpreadFrame";
import { ReaderSettingsSheet } from "./ReaderSettingsSheet";
import { NotesPanel } from "./NotesPanel";
import { ImmersiveExit } from "./ImmersiveExit";
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
  const [folio, setFolio] = useState<{ left?: number; right?: number }>({});
  // Immersive also drives the browser's own chrome away via the Fullscreen API
  // (best-effort — see useImmersive).
  const { immersive, exit: exitImmersive, toggle: toggleImmersive } =
    useImmersive();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Highlights ────────────────────────────────────────────────────────
  const highlightsRef = useRef<HighlightManager | null>(null);
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);

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

    (async () => {
      try {
        const res = await fetch(fileUrl);
        if (!res.ok) {
          throw new Error(`Couldn't download the book (HTTP ${res.status}).`);
        }
        const bytes = await res.arrayBuffer();
        if (cancelled) return;

        const controller = await createReader(bytes, initialSettings);
        if (cancelled || !viewerRef.current) {
          controller.destroy();
          return;
        }
        controllerRef.current = controller;

        unsubRelocated = controller.onRelocated((loc) => {
          if (cancelled) return;
          setPercent(loc.percent);
          // A two-page spread shows facing pages, so the right folio is the
          // next page — not the section's page count. It read "3 … 10" on
          // desktop, which is a page number beside a total. SpreadFrame hides
          // the right folio below the spread breakpoint.
          setFolio({
            left: loc.displayedPage,
            right:
              loc.displayedPage != null ? loc.displayedPage + 1 : undefined,
          });
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

        // Highlights: the manager is style-agnostic, so the concrete wash comes
        // from the design layer here. `themeRef` keeps the closure reading the
        // live theme rather than the value captured at mount.
        const highlights = manageHighlights(controller, bookId, {
          stylesFor: (color) => highlightStyles(color, themeRef.current),
        });
        highlightsRef.current = highlights;
        unsubHighlights = highlights.subscribe(setHighlights);
        await highlights.restore();

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
      highlightsRef.current?.stop();
      highlightsRef.current = null;
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

  // ── Page turn — instant (epub.js swaps content itself) ────────────────
  const turn = useCallback((dir: "next" | "prev") => {
    const controller = controllerRef.current;
    if (!controller) return;
    void (dir === "next" ? controller.next() : controller.prev());
  }, []);

  // ── Keyboard (SPEC §3.6): ←/→ pages · F immersive · Esc exits ─────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const key = e.key.toLowerCase();

      if (e.key === "Escape") {
        if (settingsOpen) return; // Radix closes the sheet itself
        if (immersive) exitImmersive();
        return;
      }

      if (settingsOpen) return; // don't drive the book while the sheet is open

      if (e.key === "ArrowRight") {
        turn("next");
      } else if (e.key === "ArrowLeft") {
        turn("prev");
      } else if (key === "f") {
        toggleImmersive();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn, immersive, settingsOpen, exitImmersive, toggleImmersive]);

  return (
    <>
      <ReaderTopBar
        title={title}
        author={author}
        hidden={immersive}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenNotes={() => setNotesOpen(true)}
        onEnterImmersive={toggleImmersive}
        highlightCount={highlights.length}
      />

      <SpreadFrame
        viewerRef={viewerRef}
        frameRef={frameRef}
        loading={load.state === "loading"}
        folioLeft={folio.left}
        folioRight={folio.right}
        onPrev={() => turn("prev")}
        onNext={() => turn("next")}
        onToggleChrome={toggleImmersive}
        immersive={immersive}
      >
        {load.state === "error" && (
          <p
            role="alert"
            className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center font-ui text-accent [font-size:var(--leaf-text-sm)]"
          >
            {load.message}
          </p>
        )}
      </SpreadFrame>

      <ReaderBottomBar
        percent={percent}
        hidden={immersive}
        onPrev={() => turn("prev")}
        onNext={() => turn("next")}
      />

      {/* Keyed so entering immersive remounts it: the control starts visible,
          then fades on its own. */}
      <ImmersiveExit
        key={immersive ? "immersive" : "windowed"}
        visible={immersive}
        onExit={exitImmersive}
      />

      <ReaderSettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSetTheme={setReaderTheme}
      />


      <NotesPanel
        open={notesOpen}
        onOpenChange={setNotesOpen}
        items={highlights.map((h) => ({
          id: h.id,
          cfiRange: h.cfiRange,
          text: h.text,
          color: h.color,
          note: h.note,
        }))}
        onGoTo={(cfiRange) => {
          setNotesOpen(false);
          void controllerRef.current?.goTo(cfiRange);
        }}
        onSetNote={(id, note) => void highlightsRef.current?.setNote(id, note)}
        onRemove={(id) => void highlightsRef.current?.remove(id)}
      />

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
