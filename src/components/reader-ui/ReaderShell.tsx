"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  createReader,
  type ReaderController,
  type ReaderTocEntry,
} from "@/reader/engine";
import { trackPosition, type PositionTracker } from "@/reader/position";
import {
  createCompletionTracker,
  type CompletionTracker,
} from "@/reader/completion";
import { recordFinished } from "@/reader/book-status";
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
import {
  readCachedBook,
  updateCachedBookProgress,
  writeCachedBook,
} from "@/lib/offline/book-store";
import { enforceOfflineOwner } from "@/lib/offline/owner";
import { highlightStyles } from "@/design/highlight-theme";
import { ReaderTopBar } from "./ReaderTopBar";
import { ReaderDock } from "./ReaderDock";
import { ReturnChip } from "./ReturnChip";
import { SyncOfferChip } from "./SyncOfferChip";
import { OfflineIndicator } from "./OfflineIndicator";
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

// Stage 4 offline reading, part 2: how often the *cached* book's `percent`
// (read by the `/offline` shelf) is refreshed as the reader moves through the
// book. 1500ms — matching `src/reader/position.ts`'s own debounce for the
// real position write — deliberately, not coincidentally: it's a cadence
// already proven cheap enough to run on every relocation without hammering
// IndexedDB, and reusing it means the offline shelf's percent and the real
// reading position go stale by about the same amount if a session ends
// mid-debounce. This is a SEPARATE timer, not a hook into position.ts's
// internal one (that file isn't ours to touch) — cosmetic data, its own
// cheap, independent, best-effort write.
const CACHE_PROGRESS_DEBOUNCE_MS = 1500;

// Defect fix (founder, 2026-10-01): "Opening the book…" was tied to
// `load.state === "loading"`, which only flips once the ENTIRE pipeline
// finishes — bytes, engine creation, first paint, locations, position
// restore, highlight/bookmark subscriptions. On an already-cached book that
// whole chain can resolve in well under 100ms, but the message still painted
// (briefly) over prose that was already on screen, because `attach()`
// paints chapter one via `rendition.display()` long before `restore()` has
// finished deciding whether to re-`goTo` a saved CFI elsewhere in the book.
// Hiding the message at FIRST paint instead would dodge the overlap but
// trade it for a worse one: the reader would briefly see chapter one, then
// get yanked to their actual saved position once `restore()` lands. So the
// message stays an OPAQUE cover (see SpreadFrame's `bg-page`) for the whole
// `loading` window rather than a transparent label — nothing under it can
// ever show through, painted or not — and these two constants decide only
// whether/how long that cover is allowed to be visible:
//   - never show it for an open that finishes inside this delay (below
//     ~200ms a reader perceives the open as instant; a flash here reads as
//     a glitch, not a status update) — a cached/fast open typically clears
//     the whole pipeline well inside this window;
//   - once shown, never flicker it away before this minimum has elapsed —
//     "Opening the book…" takes under a second to read; showing it for less
//     would strobe.
const SHOW_LOADING_DELAY_MS = 250;
const SHOW_LOADING_MIN_VISIBLE_MS = 500;

/** Must match `CACHE_READER_MESSAGE_TYPE` in `src/lib/offline/service-worker.ts`. */
const CACHE_READER_MESSAGE_TYPE = "leaf-offline/cache-reader";

/**
 * Defect fix: a `/library` → `/reader/<id>` click is a Next soft (RSC)
 * navigation, which the service worker deliberately never intercepts (see
 * `isRscRequest` in service-worker.ts) — so nothing ever asked it to cache
 * this reader's own document, and a reader who only ever clicks through from
 * the library (never reloads) had no offline copy despite the worker itself
 * working correctly. Once a book has finished opening, ask the worker to go
 * fetch-and-cache its own document, matching the reload path that already
 * worked.
 *
 * Fire-and-forget and completely best-effort: no controller yet (worker not
 * registered — demo mode, non-production build, an unsupported browser), and
 * no attempt at all while offline, where the fetch would just fail and there
 * is nothing new to cache. Never throws, never surfaces anything to the
 * reader.
 */
function requestReaderCache(bookId: string): void {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    if (navigator.onLine === false) return;
    const controller = navigator.serviceWorker.controller;
    if (!controller) return;
    controller.postMessage({
      type: CACHE_READER_MESSAGE_TYPE,
      path: `/reader/${bookId}`,
    });
  } catch {
    // Best-effort — never let this affect the reading session.
  }
}

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
  /** The book is already marked finished (`books.status`). Only ever read at
   *  open: it stops the end-of-book detector from firing a second time. May be
   *  stale if the reader rendered from a cached document — harmless, since the
   *  finish write only touches a row that is not already finished. */
  finished?: boolean;
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
  finished = false,
  initialSettings,
  debug = false,
}: ReaderShellProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ReaderController | null>(null);
  const trackerRef = useRef<PositionTracker | null>(null);
  // Finished-book detector. A ref so the jump handlers below (sync offer,
  // return chip), which live outside the engine effect, can vouch for a jump.
  const completionRef = useRef<CompletionTracker | null>(null);

  const [load, setLoad] = useState<LoadState>({ state: "loading" });

  // ── "Opening the book…" visibility (see SHOW_LOADING_* above) ──────────
  // Derived from `load.state`, not equal to it: the overlay needs its own
  // show/hide timing so a fast open never flashes it and a slow one doesn't
  // strobe it away. `timers.shownAt` (a ref, not state) is how the hide path
  // knows whether the message ever actually appeared.
  const [showLoadingMessage, setShowLoadingMessage] = useState(false);
  const loadingTimersRef = useRef<{
    showTimer?: ReturnType<typeof setTimeout>;
    hideTimer?: ReturnType<typeof setTimeout>;
    shownAt?: number;
  }>({});

  // Arms once per open (same key as the engine effect below). If the whole
  // pipeline finishes before this fires, it's cleared by `finishLoadingMessage`
  // and the message never appears at all.
  useEffect(() => {
    const timers = loadingTimersRef.current;
    timers.showTimer = setTimeout(() => {
      timers.shownAt = Date.now();
      setShowLoadingMessage(true);
    }, SHOW_LOADING_DELAY_MS);
    return () => clearTimeout(timers.showTimer);
  }, [fileUrl, bookId]);

  // Called SYNCHRONOUSLY at the exact call sites that resolve `load` to
  // "ready" or "error" (not from a separate effect reacting to `load.state`).
  // That matters: epub.js paints chapter one straight into the DOM — no
  // React render involved — well before `load` ever reaches a terminal
  // state, so by the time this runs the page is usually already sitting
  // behind the (opaque) overlay. A `useEffect` keyed on `load.state` would
  // still be correct eventually, but React doesn't run passive effects until
  // after the browser has painted the "ready" commit — one extra frame where
  // `load.state` is "ready" and the overlay hasn't been told to go yet. That
  // frame is real: a throttled-fetch test caught the overlay and the book's
  // text sharing exactly one sampled frame when this was effect-driven.
  // Calling this inline, right where `setLoad` is called, lets React 18's
  // automatic batching fold both state updates into the same commit instead.
  const finishLoadingMessage = useCallback(() => {
    const timers = loadingTimersRef.current;
    clearTimeout(timers.showTimer);
    clearTimeout(timers.hideTimer);
    if (timers.shownAt == null) {
      // The show-delay never fired — fast/cached open, nothing to hide.
      return;
    }
    const elapsed = Date.now() - timers.shownAt;
    if (elapsed >= SHOW_LOADING_MIN_VISIBLE_MS) {
      setShowLoadingMessage(false);
      return;
    }
    // Shown too recently to hide without strobing — the book is already
    // fully ready and sitting (still covered) behind the overlay, so the
    // remaining wait costs nothing but time to read three words.
    timers.hideTimer = setTimeout(
      () => setShowLoadingMessage(false),
      SHOW_LOADING_MIN_VISIBLE_MS - elapsed,
    );
  }, []);

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

  // ── Cross-device sync offer (offline defect fix, corrected) ────────────
  // A further position found on another device is OFFERED, not applied —
  // see `position.ts`'s `onSyncOffer` doc comment. Same page-turn-based
  // lifetime as `returnTo` (declared further down, near the jump-back
  // logic it belongs with), by design: the founder already settled that a
  // clock-based dismissal is the wrong rule for this reader (it would
  // retract a still-wanted offer/way-back before a reader who paused to
  // read had finished), so this reuses the exact same behaviour rather
  // than inventing a second one. Declared up here (not alongside `returnTo`)
  // because the engine effect below subscribes to `onSyncOffer` and needs
  // `setSyncOffer` in scope before it runs.
  const [syncOffer, setSyncOffer] = useState<{
    cfi: string;
    label: string | null;
  } | null>(null);
  const turnsSinceSyncOffer = useRef(0);

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
    let unsubSyncOffer: (() => void) | undefined;
    // Stage 4 part 2 — debounced, best-effort cache-percent write. Scoped to
    // this effect instance like the `unsub*` handles above, not a ref: it
    // never needs to outlive this book's engine lifecycle.
    let cacheProgressTimer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      try {
        // Fresh per book-open: this effect can re-run without an unmount
        // (bookId change), and a sync offer from the PREVIOUS book has no
        // business surviving into this one.
        setSyncOffer(null);
        turnsSinceSyncOffer.current = 0;

        // Ownership gate BEFORE the cache read, not merely at app boot. The
        // boot guard mounts in the root layout, but React commits a deeper
        // page's effects before an ancestor layout's — so on a hard
        // navigation straight to a bookmarked `/reader/<id>` this effect can
        // run first and serve one stale read out of a cache that is about to
        // be purged. Awaiting the same idempotent guard here closes that
        // window: if this device's cache belongs to someone else (or to
        // nobody), it is gone before `readCachedBook` is allowed to look.
        // Local-only — it reads the persisted session, never the network —
        // so it costs no round trip on the reader's critical path.
        await enforceOfflineOwner();
        if (cancelled) return;

        // Cache-first: a book's bytes are immutable per `bookId` (a re-upload
        // mints a new row and id — see `src/lib/storage.ts`), so a cache hit
        // is always correct by construction. This also means a long-open tab
        // whose 1-hour signed URL has expired reopens from cache instead of
        // attempting a doomed fetch.
        let bytes = await readCachedBook(bookId);
        if (cancelled) return;
        if (!bytes) {
          const res = await fetch(fileUrl);
          if (!res.ok) {
            throw new Error(
              `Couldn't download the book (HTTP ${res.status}).`,
            );
          }
          bytes = await res.arrayBuffer();
          if (cancelled) return;
          void writeCachedBook(bookId, bytes, { title, author });
        }

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

        // Created BEFORE the relocation subscription so no relocation can slip
        // past it; stays inert until `arm()` below, once the restore is done.
        const completion = createCompletionTracker({
          alreadyFinished: finished,
          onFinished: () => void recordFinished(bookId),
        });
        completionRef.current = completion;
        let lastPercent = 0;

        unsubRelocated = controller.onRelocated((loc) => {
          if (cancelled) return;
          lastPercent = loc.percent;
          completion.observe(loc);
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

          // Cosmetic, best-effort: keep the offline shelf's percent from
          // freezing at whatever it was when this book was first cached.
          // `updateCachedBookProgress` already swallows its own errors and
          // no-ops if the book isn't cached — this timer only throttles HOW
          // OFTEN it's asked to, so a fast page-turner doesn't hit IndexedDB
          // on every relocation.
          if (cacheProgressTimer) clearTimeout(cacheProgressTimer);
          cacheProgressTimer = setTimeout(() => {
            cacheProgressTimer = undefined;
            void updateCachedBookProgress(bookId, loc.percent);
          }, CACHE_PROGRESS_DEBOUNCE_MS);
        });

        await controller.attach(viewerRef.current);
        if (cancelled) {
          controller.destroy();
          return;
        }

        const tracker = trackPosition(controller, bookId);
        trackerRef.current = tracker;
        // A further position synced from another device is OFFERED, never
        // applied silently (docs/REVISED_PLAN.md §8(c) — a passive prompt,
        // not silent convergence; see position.ts's own doc comment on
        // `onSyncOffer`). Subscribed before `restore()` is even called so
        // there's no window where an unusually fast background reconcile
        // could fire before anything is listening.
        unsubSyncOffer = tracker.onSyncOffer((offer) => {
          if (cancelled) return;
          const label = formatChapterLabel(
            controllerRef.current?.chapterLabelForCfi(offer.cfi) ?? null,
          );
          turnsSinceSyncOffer.current = 0;
          setSyncOffer({ cfi: offer.cfi, label });
        });
        const restored = await tracker.restore();
        // Armed only now. The restore's own landing relocation arrives later as
        // a "jump", and on a first open on a new device its percent is a spine
        // estimate that can sit far from the stored one — read as a skip ahead
        // it would block the finish for good. Vouching for it makes that
        // landing raise the furthest point instead.
        completion.arm(lastPercent);
        if (restored) completion.markTrusted();

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

        if (!cancelled) {
          setLoad({ state: "ready" });
          finishLoadingMessage();
          // Best-effort, online-only — see requestReaderCache's doc comment.
          requestReaderCache(bookId);
        }
      } catch (err) {
        if (cancelled) return;
        setLoad({
          state: "error",
          message:
            err instanceof Error
              ? err.message
              : "This book could not be opened.",
        });
        finishLoadingMessage();
      }
    })();

    return () => {
      cancelled = true;
      if (cacheProgressTimer) clearTimeout(cacheProgressTimer);
      unsubRelocated?.();
      unsubSelected?.();
      unsubHighlights?.();
      unsubBookmarks?.();
      unsubSyncOffer?.();
      completionRef.current = null;
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
    turnsSinceSyncOffer.current += 1;
    if (turnsSinceSyncOffer.current > 8) setSyncOffer(null);
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
      // A jump to the exact CFI already on screen is not a jump — it is a
      // no-op landing, and a "Back to Ch. N" chip for the chapter you are
      // reading right now is never useful, only confusing (founder,
      // 2026-09-28: exactly this happened when a sync offer for the reader's
      // own current position — a `position.ts` float32 defect, since fixed —
      // was tapped, mistaken for a way to read its own truncated label).
      // Defensive: with that defect fixed this should be rare, but any
      // future same-place `jumpTo` (a bookmark on the current page, a TOC
      // entry for the chapter you're already in) must not leave a
      // meaningless undo behind either.
      if (from && target === from) {
        void controllerRef.current?.goTo(target);
        return;
      }
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
    // Going back to where the reader was is not a skip ahead.
    completionRef.current?.markTrusted();
    void controllerRef.current?.goTo(back.cfi);
  }, [returnTo]);

  // Explicit "no, not now" for the way-back chip — clears the offer WITHOUT
  // navigating or otherwise disturbing the current position. Per-jump, never
  // persisted: the very next jump brings the chip back regardless.
  const dismissReturnTo = useCallback(() => setReturnTo(null), []);

  // ── Accept / dismiss the cross-device sync offer ───────────────────────
  // Accepting is itself a non-linear jump, so it goes through the SAME
  // `jumpTo` chapter/bookmark navigation already uses — that's what leaves a
  // working `ReturnChip` behind for free, exactly as undoable as any other
  // jump in this reader.
  const acceptSyncOffer = useCallback(() => {
    const offer = syncOffer;
    if (!offer) return;
    setSyncOffer(null);
    // The offered place is the reader's own, read further on another device —
    // not a skip ahead. (Not inside `jumpTo`: contents and bookmark jumps
    // share it, and those ARE skips.)
    completionRef.current?.markTrusted();
    jumpTo(offer.cfi);
  }, [syncOffer, jumpTo]);

  const dismissSyncOffer = useCallback(() => setSyncOffer(null), []);

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
        // Fullscreen gives the page the browser's chrome; keeping ours in the
        // flow would hand the space straight back. So in fullscreen the bar
        // floats instead of occupying height, and merely fades — opening the
        // deck must not move the prose or force a repagination.
        overlay={immersive}
        hidden={immersive && !deckOpen}
        onToggleImmersive={toggleImmersive}
      />

      {/* Stage 4 part 3 — quiet, non-modal connectivity signal. Fades with
          the top bar in fullscreen (same `hidden` condition) rather than
          floating over the reclaimed screen. */}
      <OfflineIndicator hidden={immersive && !deckOpen} />

      <SpreadFrame
        viewerRef={viewerRef}
        frameRef={frameRef}
        loading={showLoadingMessage}
        folioLeft={folio.left}
        folioRight={folio.right}
        onPrev={() => turnAndCloseDeck("prev", "tap-prev")}
        onNext={() => turnAndCloseDeck("next", "tap-next")}
      >
        {returnTo && (
          <ReturnChip
            label={returnTo.label}
            onReturn={returnFromJump}
            onDismiss={dismissReturnTo}
          />
        )}

        {/* Suppressed while a `returnTo` chip is already showing — the two
            share the same anchor point, and a reader already mid-undo of one
            jump shouldn't be handed a second, unrelated prompt to parse. */}
        {!returnTo && syncOffer && (
          <SyncOfferChip
            label={syncOffer.label}
            onContinue={acceptSyncOffer}
            onDismiss={dismissSyncOffer}
          />
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
