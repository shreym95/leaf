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
import { ReaderTopBar } from "./ReaderTopBar";
import { ReaderBottomBar } from "./ReaderBottomBar";
import { SpreadFrame } from "./SpreadFrame";
import { ReaderSettingsSheet } from "./ReaderSettingsSheet";

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
  const [folio, setFolio] = useState<{ left?: number; right?: number }>({});
  const [immersive, setImmersive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // ── Hydrate the store once from the server-loaded row ──────────────────
  // (createReader is seeded straight from the `initialSettings` prop, so the
  // one-render gap before this effect runs is harmless.)
  useEffect(() => {
    useReaderSettings.getState().hydrate(initialSettings, userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          setFolio({ left: loc.displayedPage, right: loc.totalPages });
        });

        await controller.attach(viewerRef.current);
        if (cancelled) {
          controller.destroy();
          return;
        }

        const tracker = trackPosition(controller, bookId);
        trackerRef.current = tracker;
        await tracker.restore();

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
        if (immersive) setImmersive(false);
        return;
      }

      if (settingsOpen) return; // don't drive the book while the sheet is open

      if (e.key === "ArrowRight") {
        turn("next");
      } else if (e.key === "ArrowLeft") {
        turn("prev");
      } else if (key === "f") {
        setImmersive((v) => !v);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn, immersive, settingsOpen]);

  return (
    <>
      <ReaderTopBar
        title={title}
        author={author}
        theme={settings.theme}
        hidden={immersive}
        onSetTheme={setReaderTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <SpreadFrame
        viewerRef={viewerRef}
        frameRef={frameRef}
        loading={load.state === "loading"}
        folioLeft={folio.left}
        folioRight={folio.right}
        onPrev={() => turn("prev")}
        onNext={() => turn("next")}
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

      <ReaderSettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSetTheme={setReaderTheme}
      />
    </>
  );
}
