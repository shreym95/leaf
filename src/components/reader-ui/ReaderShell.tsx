"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import {
  createReader,
  type ReaderContentTap,
  type ReaderController,
  type ReaderTocEntry,
} from "@/reader/engine";
import { trackPosition, type PositionTracker } from "@/reader/position";
import { trackGroupProgress, type GroupProgressTracker } from "@/reader/group-progress";
import {
  createCompletionTracker,
  type CompletionTracker,
} from "@/reader/completion";
import { recordFinished, recordUnread } from "@/reader/book-status";
import { useTheme } from "@/components/theme/ThemeProvider";
import {
  useReaderSettings,
  type ReaderTheme,
} from "@/store/reader-settings";
import { isThemeId } from "@/design/themes";
import { trackScreen } from "@/lib/analytics";
import {
  cfisOverlap,
  createAnnotationManager,
  type AnnotationManager,
} from "@/reader/annotations";
import { ANNOTATION_QUOTE_MAX, listAnnotationsWithCache } from "@/lib/db/annotations";
import { createClient } from "@/lib/supabase/client";

/** The browser client, or undefined where Supabase is not configured (tests, demo). */
function browserClient() {
  try {
    return createClient();
  } catch {
    return undefined;
  }
}
import { createAnnotationWriter } from "@/lib/db/annotation-writer";
import type { Annotation } from "@/lib/types";
import {
  readCachedBook,
  updateCachedBookProgress,
  writeCachedBook,
} from "@/lib/offline/book-store";
import { enforceOfflineOwner } from "@/lib/offline/owner";
import { highlightStyles } from "@/design/highlight-theme";
import { ReaderTopBar } from "./ReaderTopBar";
import { ReaderDock } from "./ReaderDock";
import { useGroupMarkers } from "./useGroupMarkers";
import { useGroupReads } from "./useGroupReads";
import { ReaderNotes } from "./ReaderNotes";
import { SelectionBar, SelectionNotice } from "./SelectionBar";
import { HighlightBar } from "./HighlightBar";
import { BarPressHold } from "./BarPressHold";
import { HighlightNoteCard } from "./HighlightNoteCard";
import { decideContentTap, HIGHLIGHT_TAP_GUARD_MS, isCoarsePointer } from "./tap-policy";
import { EndOfBookPanel } from "./EndOfBookPanel";
import { ReturnChip } from "./ReturnChip";
import { SyncOfferChip } from "./SyncOfferChip";
import { OfflineIndicator } from "./OfflineIndicator";
import { formatChapterLabel } from "./chapter-label";
import { SpreadFrame } from "./SpreadFrame";
import { useImmersive } from "./useImmersive";

// Statuses for a Highlight or Note the shell could not make.
const NOTICE_TEXT = {
  long: "Selection too long to highlight.",
  failed: "Couldn't highlight. Try again.",
} as const;

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

/** Subscribes to connectivity changes for `useSyncExternalStore`. */
// How long a collapsed selection stays actionable, so a tap that collapsed it
// still reaches the bar's buttons.
const SELECTION_GRACE_MS = 400;

// A selection that settles this soon after a highlight tap, inside that
// highlight, is the tap's own (Android "Touch to Search" selects the tapped
// word). Past this window it is a deliberate selection.
const HIGHLIGHT_TAP_SELECTION_MS = 1000;

// Keys typed into a field (the note field, a select or search) must not page
// the book: the arrow keys and letters belong to the field.
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function subscribeConnectivity(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
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
}: ReaderShellProps) {
  const groupMarkers = useGroupMarkers(bookId);
  const groupReads = useGroupReads(bookId);
  const viewerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ReaderController | null>(null);
  const trackerRef = useRef<PositionTracker | null>(null);
  const groupProgressRef = useRef<GroupProgressTracker | null>(null);
  // Finished-book detector. A ref so the jump handlers below (sync offer,
  // return chip), which live outside the engine effect, can vouch for a jump.
  const completionRef = useRef<CompletionTracker | null>(null);

  const [load, setLoad] = useState<LoadState>({ state: "loading" });

  // ── End-of-book panel ──────────────────────────────────────────────────
  // What lies after the last page. Opened ONLY by a next-intent made while the
  // latest relocation already had `atEnd` (see `turn`); reaching the last page
  // shows nothing. `atEndRef` mirrors that latest relocation; `endPanelOpenRef`
  // mirrors the state so `turn` stays identity-stable.
  const atEndRef = useRef(false);
  const endPanelOpenRef = useRef(false);
  const [endPanelOpen, setEndPanelOpenState] = useState(false);
  // Finished state as the reader sees it: seeded from the prop, moved by the
  // tracker firing this session and by the panel's manual override. The date
  // is only known for a finish made this session — no fetch just for it.
  const [isFinished, setIsFinished] = useState(finished);
  const [finishedOn, setFinishedOn] = useState<Date | null>(null);
  // Once the reader has chosen finished/unread by hand, the detector no longer
  // gets to overrule them.
  const manualStatusRef = useRef(false);
  const setEndPanelOpen = useCallback((open: boolean) => {
    endPanelOpenRef.current = open;
    setEndPanelOpenState(open);
  }, []);

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

  // ── Notes (NOTES_PLAN N2c) ────────────────────────────────────────────
  // One annotation manager per open book: page marks and quoted ranges. It
  // paints every range, legacy ones included. Mark actions stay disabled until
  // its restore has settled, so a mark cannot be written twice.
  const annotationsRef = useRef<AnnotationManager | null>(null);
  // Writes go straight to the server while online and queue only on failure.
  const annotationWriter = useMemo(() => createAnnotationWriter({ userId }), [userId]);
  const [annotationList, setAnnotationList] = useState<Annotation[]>([]);
  const [annotationsReady, setAnnotationsReady] = useState(false);
  // ── Selection and highlight bar (NOTES_PLAN N3a / N3d) ─────────────────
  // The top bar's slot shows, in priority order: the actions for a highlight
  // whose note is being written, the actions for a settled selection, or the
  // actions for a tapped highlight. Refs mirror what the engine callbacks read,
  // so those stay identity-stable. `selectionRef` is the one actionable
  // selection: the action clears it, so a second press cannot act twice.
  // `selection` only drives what is shown, and is kept for the collapse grace window.
  const [selection, setSelection] = useState<{ cfiRange: string; text: string } | null>(
    null,
  );
  const selectionRef = useRef<{ cfiRange: string; text: string } | null>(null);
  // Why the last Highlight or Note did not happen. "long" stays with the
  // selection in the bar; "failed" outlives it until dismissed.
  const [notice, setNotice] = useState<"long" | "failed" | null>(null);
  const [barItem, setBarItem] = useState<{ kind: "highlight"; id: string } | null>(null);
  const barItemRef = useRef(barItem);
  useEffect(() => {
    barItemRef.current = barItem;
  }, [barItem]);
  // The note card's editor: the highlight it is for, and the draft. Null while
  // the card only reads. The shell owns the draft so that opening the deck,
  // which hides the card, does not lose unsaved text.
  const [cardEdit, setCardEdit] = useState<{ id: string; draft: string } | null>(null);
  const cardEditRef = useRef(cardEdit);
  useEffect(() => {
    cardEditRef.current = cardEdit;
  }, [cardEdit]);
  // Dismisses the highlight bar and its note card, and any unsaved draft with them.
  const closeBar = useCallback(() => {
    setBarItem(null);
    setCardEdit(null);
  }, []);
  // Whether the note editor holds text that is not saved. Mirrored for the
  // engine's tap callback and the keys: incidental page turns are absorbed then.
  const cardUnsavedRef = useRef(false);
  // Whether the note card is up. Mirrored for the engine's tap callback, which
  // dismisses the card on a page tap rather than turning the page.
  const noteCardShownRef = useRef(false);
  // Epoch-ms of the last collapse / highlight tap. -Infinity means "never", so
  // the first tap is never inside a guard window.
  const lastCollapseAt = useRef(Number.NEGATIVE_INFINITY);
  const lastHighlightTapAt = useRef(Number.NEGATIVE_INFINITY);
  // The highlight most recently tapped, and when, for the selection that tap
  // may produce (see HIGHLIGHT_TAP_SELECTION_MS).
  const tappedHighlightRef = useRef<{ at: number; cfi: string } | null>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const contentTapRef = useRef<(tap: ReaderContentTap) => void>(() => {});
  useEffect(
    () => () => {
      if (collapseTimerRef.current !== undefined) clearTimeout(collapseTimerRef.current);
    },
    [],
  );
  // Offline from `navigator.onLine` and the window events. The server snapshot
  // is online, so server and client agree until the client reads the real value.
  const offline = useSyncExternalStore(
    subscribeConnectivity,
    () => navigator.onLine === false,
    () => false,
  );
  // The page currently on screen: its start CFI + progress, kept so the
  // mark toggle knows what to save. A ref mirror lets the toggle callback stay
  // identity-stable.
  const [here, setHere] = useState<{
    cfi?: string;
    percent: number;
    spineHref?: string;
    sectionFraction?: number;
  }>({
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

  // A theme change re-paints the book's highlights in the new wash. Declared
  // after the ref sync above, so the repaint reads the new theme.
  useEffect(() => {
    annotationsRef.current?.repaint();
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
    let unsubSelectionCleared: (() => void) | undefined;
    let unsubContentTap: (() => void) | undefined;
    let unsubAnnotations: (() => void) | undefined;
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
        setAnnotationsReady(false);

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
          onFinished: () => {
            // The reader's own override (Mark as finished / unread) wins.
            if (manualStatusRef.current) return;
            void recordFinished(bookId);
            setIsFinished(true);
            setFinishedOn(new Date());
          },
        });
        completionRef.current = completion;
        let lastPercent = 0;

        unsubRelocated = controller.onRelocated((loc) => {
          if (cancelled) return;
          lastPercent = loc.percent;
          atEndRef.current = loc.atEnd === true;
          // Moved off the last page (a jump, a re-flow): the panel's moment has
          // passed. Focus is left where the reader put it.
          if (loc.atEnd !== true && endPanelOpenRef.current) {
            endPanelOpenRef.current = false;
            setEndPanelOpenState(false);
          }
          completion.observe(loc);
          setPercent(loc.percent);
          setHere({
            cfi: loc.cfi,
            percent: loc.percent,
            spineHref: loc.spineHref,
            sectionFraction: loc.sectionFraction,
          });
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
        groupProgressRef.current = trackGroupProgress(controller, { bookId });
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

        // Notes: the annotation manager is style-agnostic, so the concrete wash
        // comes from the design layer here. `themeRef` keeps the closure reading
        // the live theme rather than the value captured at mount. Notes can never
        // fail the open (N5): creation and the load are guarded, and the restore
        // is not awaited, so a slow notes fetch never holds the book.
        try {
          const annotations = createAnnotationManager({
            controller,
            bookId,
            userId,
            load: () => listAnnotationsWithCache(userId, bookId, browserClient()),
            writer: annotationWriter,
            stylesFor: () => highlightStyles("copper", themeRef.current),
            // The engine's highlight click also reaches the content-tap path, so
            // the time of this tap is recorded and the tap policy ignores it.
            onHighlightTap: (a) => {
              // Unsaved note text is not dropped by a tap on another highlight
              // either; the content-tap path absorbs the same tap, so it turns nothing.
              if (cardUnsavedRef.current) return;
              const at = Date.now();
              lastHighlightTapAt.current = at;
              tappedHighlightRef.current = { at, cfi: a.cfi };
              // One bar at a time: the highlight bar takes the slot, so any
              // selection goes with the bar that replaces it.
              if (selectionRef.current) {
                selectionRef.current = null;
                if (collapseTimerRef.current !== undefined) {
                  clearTimeout(collapseTimerRef.current);
                  collapseTimerRef.current = undefined;
                }
                setSelection(null);
                setNotice(null);
                controllerRef.current?.clearSelection();
              }
              setBarItem({ kind: "highlight", id: a.id });
              setCardEdit(null);
            },
          });
          annotationsRef.current = annotations;
          unsubAnnotations = annotations.subscribe(setAnnotationList);
          void annotations.restore().then(
            () => {
              if (!cancelled) setAnnotationsReady(true);
            },
            () => {
              // restore() does not reject; the guard keeps the reader safe if it ever does
            },
          );
        } catch {
          // Notes are optional for reading: the marks stay off, the book opens.
        }

        // Selection feeds the top bar's slot (SelectionBar). A settled selection
        // is actionable; its collapse opens a grace window so a tap that
        // collapsed it can still act. Taps feed the touch page-turn policy.
        unsubSelected = controller.onSelection((sel) => {
          // A selection that settles on the highlight just tapped, inside its
          // range, is part of that tap: it is dropped and the highlight bar stays.
          const tapped = tappedHighlightRef.current;
          if (
            tapped &&
            Date.now() - tapped.at <= HIGHLIGHT_TAP_SELECTION_MS &&
            cfisOverlap(sel.cfiRange, tapped.cfi)
          ) {
            controller.clearSelection();
            return;
          }
          if (collapseTimerRef.current !== undefined) {
            clearTimeout(collapseTimerRef.current);
            collapseTimerRef.current = undefined;
          }
          selectionRef.current = sel;
          setSelection(sel);
          setNotice(null);
          // A new selection replaces a highlight bar, so closing the selection
          // never reveals that bar underneath. A note being written is left alone:
          // its unsaved text would be lost.
          if (!cardEditRef.current) setBarItem((prev) => (prev?.kind === "highlight" ? null : prev));
        });
        unsubSelectionCleared = controller.onSelectionCleared(() => {
          lastCollapseAt.current = Date.now();
          if (collapseTimerRef.current !== undefined) clearTimeout(collapseTimerRef.current);
          collapseTimerRef.current = setTimeout(() => {
            collapseTimerRef.current = undefined;
            selectionRef.current = null;
            setSelection(null);
          }, SELECTION_GRACE_MS);
        });
        unsubContentTap = controller.onContentTap((tap) => contentTapRef.current(tap));

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
      unsubSelectionCleared?.();
      unsubContentTap?.();
      unsubAnnotations?.();
      unsubSyncOffer?.();
      completionRef.current = null;
      annotationsRef.current?.destroy();
      annotationsRef.current = null;
      trackerRef.current?.stop();
      trackerRef.current = null;
      groupProgressRef.current?.stop();
      groupProgressRef.current = null;
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
  //
  // The single place every next/prev intent goes through (tap zones, dock
  // buttons, arrow keys; the app has no separate swipe handler). That makes it
  // the one place the end-of-book panel is gated:
  //   - panel open: previous closes it (staying on the last page), next does
  //     nothing, and neither reaches the engine;
  //   - on the last page: next opens the panel instead of turning — either
  //     because the latest relocation had `atEnd`, or because the engine's own
  //     `next()` reports it could not move at the end of the book.
  const closeEndPanel = useCallback(
    (restoreFocus: boolean) => {
      if (!endPanelOpenRef.current) return;
      setEndPanelOpen(false);
      if (restoreFocus) frameRef.current?.focus({ preventScroll: true });
    },
    [setEndPanelOpen],
  );

  // Clears the book's selection and the bar's record of it. Turning a page and
  // a touch tap that is not a turn both go through here.
  const dropSelection = useCallback(() => {
    selectionRef.current = null;
    if (collapseTimerRef.current !== undefined) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = undefined;
    }
    setSelection(null);
    setNotice(null);
    controllerRef.current?.clearSelection();
  }, []);

  const turn = useCallback(
    (dir: "next" | "prev") => {
      const controller = controllerRef.current;
      if (!controller) return;
      if (endPanelOpenRef.current) {
        if (dir === "prev") closeEndPanel(true);
        return;
      }
      if (dir === "next" && atEndRef.current) {
        setEndPanelOpen(true);
        return;
      }
      // A page turn clears the selection and any tapped-highlight actions: both
      // belong to the page on screen. Unsaved note text stays put (the deck's
      // own turns come through here while the card is hidden).
      if (selectionRef.current) dropSelection();
      if (!cardUnsavedRef.current) closeBar();
      turnsSinceJump.current += 1;
      if (turnsSinceJump.current > 8) setReturnTo(null);
      turnsSinceSyncOffer.current += 1;
      if (turnsSinceSyncOffer.current > 8) setSyncOffer(null);
      if (dir === "prev") {
        void controller.prev();
        return;
      }
      // A next the engine could not make because the book is over opens the
      // panel on THIS tap. epub.js's `atEnd` can stay false on the true last
      // page, so `atEndRef` alone would leave the reader tapping at nothing.
      void Promise.resolve(controller.next()).then(
        (result) => {
          if (controllerRef.current !== controller) return;
          if (result?.atEnd === true && !endPanelOpenRef.current) {
            setEndPanelOpen(true);
          }
        },
        () => {
          // a rejected turn moved nowhere; nothing to open
        },
      );
    },
    [closeEndPanel, setEndPanelOpen, dropSelection, closeBar],
  );

  const markFinishedByHand = useCallback(() => {
    manualStatusRef.current = true;
    setIsFinished(true);
    setFinishedOn(new Date());
    void recordFinished(bookId);
  }, [bookId]);

  const markUnreadByHand = useCallback(() => {
    manualStatusRef.current = true;
    setIsFinished(false);
    setFinishedOn(null);
    void recordUnread(bookId);
  }, [bookId]);

  // A page turn from OUTSIDE the deck (tap zones, arrow keys) collapses it —
  // "closes on … a page turn". The deck's own `‹` / `›` call `turn` directly so
  // a keyboard user can page through with the deck up (decision 2).
  const turnAndCloseDeck = useCallback(
    (dir: "next" | "prev") => {
      turn(dir);
      setDeckOpen(false);
    },
    [turn],
  );

  // ── Touch page turns (NOTES_PLAN N3d) ───────────────────────────────────
  // Coarse pointers only: the edge buttons are pass-through there, so every
  // tap in the book lands here. A tap with a selection active only clears it.
  // Fine pointers get "ignore" and keep the edge buttons. The engine callback
  // reads this through a ref, so the subscription made at load stays current.
  useEffect(() => {
    contentTapRef.current = (tap) => {
      const now = Date.now();
      // A page tap with a note card up only dismisses the card: it turns nothing.
      // The highlight guard keeps the tap that opened or switched the card from
      // closing it, as it keeps that tap from turning the page.
      if (
        noteCardShownRef.current &&
        now - lastHighlightTapAt.current >= HIGHLIGHT_TAP_GUARD_MS
      ) {
        // Unsaved note text is never discarded by a tap: the tap is absorbed and
        // the editor stays open. Save, Cancel or Esc decide what happens to it.
        if (cardUnsavedRef.current) return;
        closeBar();
        return;
      }
      const action = decideContentTap({
        coarse: isCoarsePointer(),
        selectionActive: tap.selectionActive,
        msSinceCollapse: now - lastCollapseAt.current,
        msSinceHighlightTap: now - lastHighlightTapAt.current,
        xFraction: tap.xFraction,
      });
      if (action === "clear-selection") {
        dropSelection();
        return;
      }
      if (action === "prev" || action === "next") turnAndCloseDeck(action);
    };
  }, [dropSelection, turnAndCloseDeck, closeBar]);

  // Opening the deck hides the bar, so its selection and highlight actions are
  // dropped here, on the open itself. A note being written is kept (it is only
  // hidden, not discarded): its draft and the highlight it belongs to stay, and
  // the editor comes back with the deck closed.
  const setDeckOpenFromDock = useCallback(
    (open: boolean) => {
      if (open) {
        if (selectionRef.current) dropSelection();
        if (!cardEditRef.current) setBarItem((prev) => (prev?.kind === "highlight" ? null : prev));
      }
      setDeckOpen(open);
    },
    [dropSelection],
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
      closeEndPanel(false);
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
    [chapterLabel, closeEndPanel],
  );

  const returnFromJump = useCallback(() => {
    const back = returnTo;
    if (!back) return;
    setReturnTo(null);
    // Deliberately NOT vouched for: "back to" may be a place the reader only
    // reached by skipping ahead. Returning to genuine ground is recognised by
    // the completion rule's own return margin.
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

  // ── Mark / un-mark the page on screen (NOTES_PLAN §1.2) ───────────────
  // One tap creates or removes the page mark at this page's start CFI. The
  // manager decides which: `markPage` toggles on an exact CFI match. Inert until
  // the notes restore has settled, so a mark is never written twice.
  const toggleMark = useCallback(() => {
    const mgr = annotationsRef.current;
    const { cfi, percent } = hereRef.current;
    if (!mgr || !cfi || !annotationsReady) return;
    void mgr
      .markPage({
        cfi,
        label: controllerRef.current?.currentChapterLabel() ?? null,
        percent,
      })
      .catch(() => {
        // markPage swallows its own write errors; nothing here may reach reading
      });
  }, [annotationsReady]);

  const saveNote = useCallback((id: string, note: string | null) => {
    annotationsRef.current?.setNote(id, note).catch(() => {
      // a rejected note (bad length) leaves the item as it was
    });
  }, []);

  const removeAnnotation = useCallback((id: string) => {
    void annotationsRef.current?.remove(id);
  }, []);

  // Highlight or Note on the settled selection. The action takes the selection
  // once and clears the book's selection; the manager paints it and returns the
  // existing highlight when the range overlaps one. Note then opens the note
  // field on that highlight.
  const actOnSelection = useCallback(
    (then: "highlight" | "note") => {
      const sel = selectionRef.current;
      const mgr = annotationsRef.current;
      if (!sel || !mgr || !annotationsReady) return;
      // A quote over the manager's limit is refused before anything is painted.
      // The selection stays in the bar so the reader can trim it or dismiss it.
      if (Array.from(sel.text).length > ANNOTATION_QUOTE_MAX) {
        setNotice("long");
        return;
      }
      // Taking the action drops the bar's record of the selection at once, so
      // the bar leaves with it rather than lingering through the grace window.
      dropSelection();
      const { percent } = hereRef.current;
      const label = controllerRef.current?.currentChapterLabel() ?? null;
      void mgr
        .highlight({ cfiRange: sel.cfiRange, quote: sel.text, label, percent })
        .then(
          (saved) => {
            // Note opens the card's editor on the highlight (empty, unless the
            // range overlapped one that already has a note).
            if (saved && then === "note") {
              setBarItem({ kind: "highlight", id: saved.id });
              setCardEdit({ id: saved.id, draft: saved.note ?? "" });
            }
          },
          () => {
            // highlight() rejects on invalid input (it does not reach the write);
            // the reader is told, not left with a bar that closed for nothing
            setNotice("failed");
          },
        );
    },
    [annotationsReady, dropSelection],
  );

  const removeFromBar = useCallback(
    (id: string) => {
      removeAnnotation(id);
      closeBar();
    },
    [removeAnnotation, closeBar],
  );

  // Save in the card writes the note and returns the card to its read view (or,
  // for an emptied note, to the highlight's own bar, which offers Add note again).
  const saveNoteFromCard = useCallback(
    (id: string, note: string | null) => {
      saveNote(id, note);
      setCardEdit(null);
    },
    [saveNote],
  );

  // ── Keyboard (SPEC §3.6): ←/→ pages · F immersive · Esc exits ─────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const key = e.key.toLowerCase();

      if (e.key === "Escape") {
        if (deckOpen) return; // ReaderDock owns Esc while the deck is open
        // The bar goes first: an open note editor cancels its draft, then the
        // highlight bar and its card, then a selection.
        if (cardEditRef.current) {
          setCardEdit(null);
          return;
        }
        if (barItemRef.current) {
          closeBar();
          return;
        }
        if (selectionRef.current) {
          dropSelection();
          return;
        }
        if (endPanelOpenRef.current) {
          closeEndPanel(true);
          return;
        }
        if (immersive) exitImmersive();
        return;
      }

      if (isTypingTarget(e.target)) return;

      // A page key is incidental: with unsaved note text it turns nothing.
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        if (cardUnsavedRef.current) return;
        turnAndCloseDeck(e.key === "ArrowRight" ? "next" : "prev");
      } else if (key === "f") {
        toggleImmersive();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    turnAndCloseDeck,
    closeEndPanel,
    immersive,
    deckOpen,
    exitImmersive,
    toggleImmersive,
    dropSelection,
    closeBar,
  ]);

  // The bar's content, in priority order. Nothing while the deck is open.
  let barNode: ReactNode = null;
  // The note card under the bar, if any: the editor while it is open on the
  // active highlight, else the read view of a highlight that has a note.
  let cardNode: ReactNode = null;
  const activeHighlight = barItem ? annotationList.find((a) => a.id === barItem.id) : undefined;
  const editingDraft =
    activeHighlight && cardEdit && cardEdit.id === activeHighlight.id ? cardEdit : null;
  // Unsaved text is the one thing a dismissal must not discard. Mirrored for
  // the tap and key paths, which read it through refs.
  const cardDirty =
    activeHighlight !== undefined &&
    editingDraft !== null &&
    editingDraft.draft !== (activeHighlight.note ?? "");
  useEffect(() => {
    cardUnsavedRef.current = cardDirty;
  }, [cardDirty]);
  const noteCardFor = (a: Annotation, draft: string | null) => (
    <HighlightNoteCard
      key={a.id}
      note={a.note ?? ""}
      editing={draft !== null}
      draft={draft ?? ""}
      onDraftChange={(next) => setCardEdit({ id: a.id, draft: next })}
      onEdit={() => setCardEdit({ id: a.id, draft: a.note ?? "" })}
      onSave={(note) => saveNoteFromCard(a.id, note)}
      onCancel={() => setCardEdit(null)}
      onRemove={() => removeFromBar(a.id)}
    />
  );
  if (!deckOpen && activeHighlight) {
    if (editingDraft) {
      barNode = (
        <HighlightBar
          note={activeHighlight.note}
          editing
          onNote={() => setCardEdit({ id: activeHighlight.id, draft: "" })}
          onRemove={() => removeFromBar(activeHighlight.id)}
          onClose={closeBar}
        />
      );
      cardNode = noteCardFor(activeHighlight, editingDraft.draft);
    }
  }
  if (!deckOpen && !editingDraft) {
    if (selection) {
      barNode = (
        <SelectionBar
          text={selection.text}
          onHighlight={() => actOnSelection("highlight")}
          onNote={() => actOnSelection("note")}
          onClose={dropSelection}
          notice={notice === "long" ? NOTICE_TEXT.long : null}
        />
      );
    } else if (notice === "failed") {
      barNode = (
        <SelectionNotice text={NOTICE_TEXT.failed} onDismiss={() => setNotice(null)} />
      );
    } else if (activeHighlight) {
      barNode = (
        <HighlightBar
          note={activeHighlight.note}
          onNote={() => setCardEdit({ id: activeHighlight.id, draft: "" })}
          onRemove={() => removeFromBar(activeHighlight.id)}
          onClose={closeBar}
        />
      );
      if (activeHighlight.note) cardNode = noteCardFor(activeHighlight, null);
    }
  }
  const noteCardShown = cardNode !== null;
  useEffect(() => {
    noteCardShownRef.current = noteCardShown;
  }, [noteCardShown]);

  return (
    <>
      {/* Holds the bar under a pressing finger until that press's click has
          passed (see BarPressHold). The slot shows what it hands back. */}
      <BarPressHold live={barNode}>
        {(shown) => (
          <ReaderTopBar
            immersive={immersive}
            // Fullscreen gives the page the browser's chrome; keeping ours in the
            // flow would hand the space straight back. So in fullscreen the bar
            // floats instead of occupying height, and merely fades — opening the
            // deck must not move the prose or force a repagination.
            overlay={immersive}
            hidden={immersive && !deckOpen && shown === null}
            onToggleImmersive={toggleImmersive}
            slot={shown ?? undefined}
            card={cardNode}
          />
        )}
      </BarPressHold>

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
        onPrev={() => turnAndCloseDeck("prev")}
        onNext={() => turnAndCloseDeck("next")}
      >
        {endPanelOpen && (
          <EndOfBookPanel
            title={title}
            author={author}
            finished={isFinished}
            finishedOn={finishedOn}
            onClose={() => closeEndPanel(true)}
            onMarkFinished={markFinishedByHand}
            onMarkUnread={markUnreadByHand}
          />
        )}

        {returnTo && !endPanelOpen && (
          <ReturnChip
            label={returnTo.label}
            onReturn={returnFromJump}
            onDismiss={dismissReturnTo}
          />
        )}

        {/* Suppressed while a `returnTo` chip is already showing — the two
            share the same anchor point, and a reader already mid-undo of one
            jump shouldn't be handed a second, unrelated prompt to parse. */}
        {!returnTo && !endPanelOpen && syncOffer && (
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
        onOpenChange={setDeckOpenFromDock}
        percent={percent}
        markers={groupMarkers}
        chapterLabel={chapterLabel}
        toc={toc}
        onNavigate={(href) => jumpTo(href)}
        onPrevPage={() => turn("prev")}
        onNextPage={() => turn("next")}
        theme={settings.theme}
        onSetTheme={setReaderTheme}
        fontSize={settings.fontSize}
        onSetFontSize={(size) => useReaderSettings.getState().setFontSize(size)}
        bookmarked={
          here.cfi != null &&
          annotationList.some((a) => a.kind === "page" && a.cfi === here.cfi)
        }
        canBookmark={Boolean(here.cfi) && annotationsReady}
        onToggleBookmark={toggleMark}
        notesPanel={
          <ReaderNotes
            mine={annotationList}
            groupReads={groupReads}
            locateCfi={(cfi) => controllerRef.current?.locateCfi(cfi) ?? null}
            offline={offline}
            onJump={(target) => {
              setDeckOpen(false);
              jumpTo(target);
            }}
            onSaveNote={saveNote}
            onRemove={removeAnnotation}
            writer={annotationWriter}
          />
        }
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
