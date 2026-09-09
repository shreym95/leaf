// Reader engine — the epub.js controller (SPEC §3.4, §3.7, §8). LOGIC ONLY:
// style-agnostic, no imports from `src/design` or `src/components` (ESLint seam
// rule). The fine-press stylesheet (drop cap, justified body, small-caps lede)
// is injected by Agent B's content pipeline; this engine owns only the
// *variable* bits — font family/size, line spacing, page margins, day/night —
// plus pagination, spread, and position events.
//
// Config mirrors the approved v0.1 prototype
// (`reference/approved-v0.1-reader.html`): `renderTo` with
// `manager:"default", flow:"paginated", width/height:"100%"`, spread driven off
// viewport width, `book.locations.generate(1200)` in the background, and a
// `relocated` handler for progress. epub.js does ALL column/clip math — we
// never hand-roll it (the prototype proved hand-rolling breaks across widths).

import type { Book, Rendition } from "epubjs";
import type { ThemeName } from "@/lib/types";
import { createDebugProbe, type ReaderDebugProbe } from "./debug";

// Re-exported so the reader chrome imports one module, not two.
export type {
  ReaderDebugSnapshot,
  ReaderDebugTurn,
  ReaderDebugImages,
} from "./debug";
import type { ReaderDebugSnapshot } from "./debug";

// --- Shared interface (Agents B & C code against these EXACT shapes) --------

export interface ReaderContentSettings {
  fontFamily: "serif" | "sans" | "legible";
  fontSize: number; // rem (default 1.06)
  lineSpacing: number; // default 1.62
  margins: "narrow" | "normal" | "wide";
  /** The persisted theme union — widening it must not need an edit here. */
  theme: ThemeName;
}

export interface ReaderLocation {
  cfi: string;
  /**
   * 0..1 through the book. Exact once the locations table is loaded; before
   * that it is a spine-position estimate (see `estimated`), never a raw 0 —
   * an honest 0% on open read as a broken progress bar (DEFECTS.md D7).
   */
  percent: number;
  /**
   * True while `percent` is the estimate rather than a `book.locations`
   * reading. Only ever true on a book's first open on this device, and only
   * until the table finishes generating. `cfi` is exact either way.
   */
  estimated?: boolean;
  displayedPage?: number; // rendition.currentLocation().start.displayed.page
  totalPages?: number;
}

export interface ReaderController {
  attach(container: HTMLElement): Promise<void>; // renderTo + display + locations.generate
  /** `source` is debug-only bookkeeping (which control was used); ignored otherwise. */
  next(source?: string): Promise<void>;
  prev(source?: string): Promise<void>;
  goTo(target: string): Promise<void>; // CFI or spine href
  /** Best-effort chapter title for the current position, from the EPUB's own
   *  table of contents. Denormalised onto a bookmark at save time (Phase 2) so
   *  a bookmark list renders without re-resolving CFIs. `undefined` when the
   *  TOC has no entry for the current section. */
  currentChapterLabel(): string | undefined;
  relayout(): void; // recompute spread (call on resize; debounced inside)
  applySettings(s: ReaderContentSettings): void; // -> rendition.themes / font / override
  onRelocated(cb: (loc: ReaderLocation) => void): () => void; // returns an unsubscribe fn
  /** Fires when the user finishes selecting text in the book. */
  onSelected(cb: (sel: { cfiRange: string; text: string }) => void): () => void;
  /** Paint a highlight. `styles` is supplied by the caller (design layer decides colour). */
  addHighlight(
    cfiRange: string,
    opts: { id: string; styles: Record<string, string>; onClick?: () => void },
  ): void;
  removeHighlight(cfiRange: string): void;
  /** Clear the current text selection in the book iframe. */
  clearSelection(): void;
  readonly sectionCount: number;
  /** Live pagination/geometry/image-timing readout. Present ONLY when
   *  `createReader` was asked for `{ debug: true }` (behind `?debug=1`);
   *  returns null otherwise. OBSERVE-ONLY — see `./debug`. */
  debugSnapshot?(): ReaderDebugSnapshot | null;
  /** Subscribe to debug snapshots (relocation, turn, resize, late image load).
   *  Returns an unsubscribe fn, or null when debug is off. */
  onDebug?(cb: (snap: ReaderDebugSnapshot) => void): (() => void) | null;
  destroy(): void;
}

// The content pipeline (normalizer hook + fine-press stylesheet + Day/Night
// theming of the book iframe) lives in `./content-hook` — same layer, allowed.
// Wired in `attach()` BEFORE the first `rendition.display()` so chapter one
// renders through it; refreshed on every settings change.
import { registerContentPipeline } from "./content-hook";
import {
  readCachedLocations,
  writeCachedLocations,
} from "./locations-cache";

// All book-content styling (fonts, size, spacing, margins, Day/Night) is owned
// by the content pipeline (`./content-hook`) — it injects one authoritative
// `<style>` per chapter. The engine just tells it to refresh and re-flows.

const SPREAD_MIN_WIDTH = 1024; // ≥ this → two-page spread, else single page

// Granularity of the locations table. Part of the cache key: change it and
// every stored table is correctly ignored rather than silently misread.
const LOCATION_CHARS = 1200;

/**
 * Remove accumulated sub-pixel scroll drift before a forward turn.
 *
 * DEFECTS.md D2. epub.js decides whether a section has another page with
 * (managers/default/index.js, `next()`):
 *
 *     left = container.scrollLeft + container.offsetWidth + layout.delta;
 *     if (left <= container.scrollWidth) scrollBy(delta) else -> next section
 *
 * and it advances with `container.scrollLeft += delta`. On a device whose pixel
 * ratio is fractional the browser snaps every scroll offset to a whole DEVICE
 * pixel, so each `+=` lands slightly past the exact page boundary and the error
 * compounds. Measured on an Android phone at dpr 2.975, where a 409px page step
 * snaps to 1217 device px = 409.0756 css px — drifting +0.0756 per page:
 *
 *     page 11  scrollLeft 4090.08   (11 x 409 = 4090)
 *     page 15  scrollLeft 5726.39   (14 x 409 = 5726)
 *     page 18  scrollLeft 6953.61   (17 x 409 = 6953)
 *
 * until on that second-to-last page `6953.61 + 409 + 409 = 7771.61` exceeds
 * `scrollWidth 7771` by 0.61px, epub.js concludes the chapter is finished, and
 * the final page is never shown.
 *
 * So snap back to the exact page boundary before handing the turn over, but only
 * while a page demonstrably remains. Geometry decides that, NOT `displayed.page`
 * — the same device logs reported page `1` while sitting on page 18.
 *
 * The 1px undershoot is deliberate: assigning `scrollLeft` re-snaps to a device
 * pixel too, which can land a fraction ABOVE the boundary and fail the test all
 * over again. One pixel is far below the threshold of visibility, and far below
 * the ~delta-sized margin separating "another page" from "chapter finished", so
 * it cannot manufacture a phantom page.
 */
export function undriftForNextPage(rendition: unknown): void {
  const manager = (
    rendition as {
      manager?: { container?: HTMLElement; layout?: { delta?: number } };
    } | undefined
  )?.manager;
  const container = manager?.container;
  const delta = manager?.layout?.delta;
  if (!container || typeof delta !== "number" || !(delta > 0)) return;

  const pages = Math.round(container.scrollWidth / delta);
  const index = Math.round(container.scrollLeft / delta);
  if (!Number.isFinite(pages) || !Number.isFinite(index)) return;
  // At the true end of a section epub.js must stay free to move to the next one.
  if (index >= pages - 1) return;

  const exact = index * delta;
  if (container.scrollLeft > exact) {
    container.scrollLeft = Math.max(0, exact - 1);
  }
}

/**
 * After stepping BACK into the previous chapter, make sure we land on its LAST
 * page — the way turning back a page in a printed book works.
 *
 * DEFECTS.md D6. epub.js already intends this: `prev()` ends with
 * `scrollTo(container.scrollWidth - layout.delta)`
 * (managers/default/index.js). But that reads `scrollWidth` at a moment when the
 * prepended view may not have settled at its final width, and an on-device log
 * caught it landing on page 1 of a 23-page chapter instead of page 23:
 *
 *     #67 tap-prev  s15 1/18 -> s14 1/23
 *     #63 tap-prev  s15 1/14 -> s14 1/19
 *
 * Both happened immediately after a section change, which is the moment the
 * measurement is least settled. So re-assert the destination from geometry once
 * the turn has resolved, and only when the section actually changed — paging
 * back WITHIN a chapter must be left alone.
 *
 * Not reproducible off-device (the harness lands correctly with and without the
 * D5 fix), so this is deliberately a re-assertion rather than a timing patch: if
 * epub.js already got it right, this is a no-op.
 */
function snapBackToChapterEnd(rendition: unknown, previousIndex: number | undefined): void {
  const manager = (
    rendition as {
      manager?: { container?: HTMLElement; layout?: { delta?: number } };
    } | undefined
  )?.manager;
  const container = manager?.container;
  const delta = manager?.layout?.delta;
  if (!container || typeof delta !== "number" || !(delta > 0)) return;

  const index = sectionIndexOf(rendition);
  // Only when we actually crossed into an earlier section.
  if (index === undefined || previousIndex === undefined) return;
  if (index >= previousIndex) return;

  const pages = Math.round(container.scrollWidth / delta);
  if (!Number.isFinite(pages) || pages < 2) return;

  const lastPage = (pages - 1) * delta;
  // Already there (allowing for the sub-pixel scroll snapping behind D2).
  if (container.scrollLeft >= lastPage - 1) return;
  container.scrollLeft = lastPage;
}

/** Current spine index, or undefined if epub.js cannot report one right now. */
function sectionIndexOf(rendition: unknown): number | undefined {
  try {
    const here = (
      rendition as { currentLocation?: () => unknown } | undefined
    )?.currentLocation?.() as { start?: { index?: number } } | undefined;
    const index = here?.start?.index;
    return typeof index === "number" ? index : undefined;
  } catch {
    // currentLocation throws mid-transition; treat as unknown.
    return undefined;
  }
}

/**
 * A rough 0..1 position from the spine alone, for the window before the
 * locations table exists (DEFECTS.md D7).
 *
 * It weights every section equally, so it is not the real percentage — a long
 * chapter advances it too slowly and a short one too fast. What it is, is
 * monotonic, instant, and never a flat 0 on chapter twelve. The exact value
 * replaces it as soon as `book.locations` is ready, which on a cached book is
 * before the first page paints.
 *
 * Returns `undefined` when the spine length is unknown — the caller then keeps
 * the old behaviour of reporting 0.
 */
export function estimateProgress(
  sectionIndex: number | undefined,
  sectionCount: number,
  page?: number,
  totalPages?: number,
): number | undefined {
  if (!Number.isFinite(sectionCount) || sectionCount <= 0) return undefined;
  if (typeof sectionIndex !== "number" || !Number.isFinite(sectionIndex)) {
    return undefined;
  }
  const index = Math.min(Math.max(sectionIndex, 0), sectionCount - 1);

  // How far into the current section we are, when epub.js knows. `page` is
  // 1-based, so page 1 of 10 is the start of the section, not a tenth in.
  let within = 0;
  if (
    typeof page === "number" &&
    typeof totalPages === "number" &&
    Number.isFinite(page) &&
    Number.isFinite(totalPages) &&
    totalPages > 1
  ) {
    within = Math.min(Math.max((page - 1) / (totalPages - 1), 0), 1);
  }

  return Math.min(Math.max((index + within) / sectionCount, 0), 1);
}

function spreadFor(width: number): "always" | "none" {
  return width >= SPREAD_MIN_WIDTH ? "always" : "none";
}

/** An element's content box — its border box less its own padding. */
function contentBox(
  el: HTMLElement | undefined,
): { width: number; height: number } | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  return {
    width: rect.width - px(cs.paddingLeft) - px(cs.paddingRight),
    height: rect.height - px(cs.paddingTop) - px(cs.paddingBottom),
  };
}

function viewportWidth(container: HTMLElement | undefined): number {
  const cw = container?.clientWidth ?? 0;
  if (cw > 0) return cw;
  return typeof window !== "undefined" ? window.innerWidth : SPREAD_MIN_WIDTH;
}

// --- Factory -------------------------------------------------------------

export interface ReaderEngineOptions {
  /** Build the debug probe (`./debug`). Off by default — a normal reader never
   *  pays for it, and nothing about pagination changes when it is on. */
  debug?: boolean;
  /**
   * The library row id for this book. Used only as the locations-cache key
   * (DEFECTS.md D7). Omitted — as in a test or a one-off render — the reader
   * behaves exactly as before, generating the table on every open.
   */
  bookId?: string;
}

export async function createReader(
  bytes: ArrayBuffer,
  initial: ReaderContentSettings,
  options?: ReaderEngineOptions,
): Promise<ReaderController> {
  // epub.js is browser-only (needs the DOM). Dynamic import so this module is
  // safe to evaluate during SSR; callers still invoke `createReader` from a
  // client effect.
  const { default: ePub } = await import("epubjs");

  // ArrayBuffer, never a URL: the M2 bootstrap proved a signed `.epub?token=…`
  // URL makes epub.js hang (it misreads it as an unpacked directory).
  const book: Book = ePub(bytes);
  await book.ready;

  let sectionCount = 0;
  try {
    const spine = await book.loaded.spine;
    sectionCount = Array.isArray(spine)
      ? spine.length
      : ((spine as { length?: number })?.length ?? 0);
  } catch {
    sectionCount = 0;
  }

  let currentSettings: ReaderContentSettings = { ...initial };
  let rendition: Rendition | undefined;
  let containerEl: HTMLElement | undefined;
  let contentPipeline: ReturnType<typeof registerContentPipeline> | undefined;
  let debugProbe: ReaderDebugProbe | undefined;
  let locationsReady = false;
  let currentSpread: "always" | "none" = "none";
  let relayoutTimer: ReturnType<typeof setTimeout> | undefined;
  let redisplayTimer: ReturnType<typeof setTimeout> | undefined;
  let lastKnownCfi: string | undefined;

  const subscribers = new Set<(loc: ReaderLocation) => void>();
  const selectionSubscribers = new Set<
    (sel: { cfiRange: string; text: string }) => void
  >();
  let lastSelectionCfi: string | undefined;

  function emit(loc: ReaderLocation): void {
    for (const cb of subscribers) {
      try {
        cb(loc);
      } catch {
        // a bad subscriber must not break relocation handling for the others
      }
    }
  }

  // epub.js emits `selected(cfiRange, contents)` when a selection settles in a
  // chapter iframe. `contents.window` is the iframe window — read the selected
  // string from it. Empty / collapsed selections and repeats of the last range
  // are ignored so the caller only sees real, new selections.
  function handleSelected(rawCfi: unknown, rawContents: unknown): void {
    if (typeof rawCfi !== "string" || !rawCfi) return;
    let text = "";
    try {
      const win = (rawContents as { window?: Window } | undefined)?.window;
      text = win?.getSelection?.()?.toString().trim() ?? "";
    } catch {
      text = "";
    }
    if (!text) return;
    if (rawCfi === lastSelectionCfi) return;
    lastSelectionCfi = rawCfi;
    for (const cb of selectionSubscribers) {
      try {
        cb({ cfiRange: rawCfi, text });
      } catch {
        // a bad subscriber must not break selection handling for the others
      }
    }
  }

  // epub.js `relocated` payload is loosely typed across versions; read defensively.
  function handleRelocated(raw: unknown): void {
    const loc = raw as {
      start?: {
        cfi?: string;
        index?: number;
        displayed?: { page?: number; total?: number };
      };
      cfi?: string;
    };
    const cfi = loc?.start?.cfi ?? loc?.cfi;
    if (!cfi) return;
    lastKnownCfi = cfi;

    const page = loc?.start?.displayed?.page;
    const totalPages = loc?.start?.displayed?.total;

    let percent = 0;
    let estimated = false;
    if (locationsReady) {
      const p = book.locations.percentageFromCfi(cfi);
      percent = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
    } else {
      // Locations are still generating (first open of this book on this
      // device). Report the spine estimate rather than 0 — see D7.
      const est = estimateProgress(
        loc?.start?.index,
        sectionCount,
        page,
        totalPages,
      );
      if (est !== undefined) {
        percent = est;
        estimated = true;
      }
    }

    emit({
      cfi,
      percent,
      estimated,
      displayedPage: page,
      totalPages,
    });
  }

  function currentCfi(): string | undefined {
    try {
      const here = rendition?.currentLocation() as
        | { start?: { cfi?: string } }
        | undefined;
      return here?.start?.cfi ?? lastKnownCfi;
    } catch {
      return lastKnownCfi;
    }
  }

  // Best-effort: walk the EPUB's own TOC for the entry whose href matches the
  // given spine href (fragments and leading `./` stripped from both sides), and
  // return its label. Used to denormalise a chapter title onto a bookmark at
  // save time — never load-bearing, so any miss returns undefined.
  type NavItemish = { href?: string; label?: string; subitems?: unknown[] };
  function chapterLabelForHref(href: string | undefined): string | undefined {
    if (!href) return undefined;
    try {
      const toc = (book.navigation as { toc?: unknown } | undefined)?.toc;
      if (!Array.isArray(toc) || toc.length === 0) return undefined;
      const bare = (s: string) => s.split("#")[0].replace(/^\.?\//, "");
      const want = bare(href);
      const walk = (items: NavItemish[]): string | undefined => {
        for (const it of items) {
          if (typeof it?.href === "string" && bare(it.href) === want) {
            const label = typeof it.label === "string" ? it.label.trim() : "";
            if (label) return label;
          }
          const sub = Array.isArray(it?.subitems)
            ? (it.subitems as NavItemish[])
            : undefined;
          if (sub) {
            const nested = walk(sub);
            if (nested) return nested;
          }
        }
        return undefined;
      };
      return walk(toc as NavItemish[]);
    } catch {
      return undefined;
    }
  }

  // epub.js applies theme/CSS changes to the iframe but does NOT re-flow the
  // paginated columns — the current page goes blank until the next turn forces
  // a re-layout. Re-`display()` the current CFI to re-flow in place. Coalesced
  // so dragging a slider doesn't thrash.
  function scheduleReflow(): void {
    if (!rendition) return;
    if (redisplayTimer) clearTimeout(redisplayTimer);
    redisplayTimer = setTimeout(() => {
      redisplayTimer = undefined;
      const cfi = currentCfi();
      if (rendition && cfi) void Promise.resolve(rendition.display(cfi)).catch(() => {});
    }, 90);
  }

  const controller: ReaderController = {
    async attach(container: HTMLElement): Promise<void> {
      containerEl = container;
      currentSpread = spreadFor(viewportWidth(container));

      rendition = book.renderTo(container, {
        manager: "default",
        flow: "paginated",
        width: "100%",
        height: "100%",
        spread: currentSpread,
      });

      // Wire the content pipeline BEFORE the first display so chapter one
      // renders through it.
      contentPipeline = registerContentPipeline(
        rendition,
        () => currentSettings,
      );

      // Debug instrumentation, opt-in only. Registered AFTER the content
      // pipeline so it observes the normalised DOM, and BEFORE the first
      // display so chapter one's image timing is captured too.
      if (options?.debug) {
        try {
          debugProbe = createDebugProbe({
            rendition,
            // The engine's own measurement — literally what `relayout()` passes.
            measure: () => contentBox(containerEl),
            getSpread: () => currentSpread,
          });
        } catch {
          // instrumentation must never stop the book from opening
        }
      }

      rendition.on("relocated", handleRelocated);
      rendition.on("selected", handleSelected);

      // A locations table cached from an earlier open makes `percent` exact
      // from the very first `relocated` event: no generate pass, no estimate
      // window, no 0% (DEFECTS.md D7). `load()` is synchronous, so this has to
      // happen before the first display, not after it.
      const cachedLocations = options?.bookId
        ? readCachedLocations(options.bookId, LOCATION_CHARS)
        : undefined;
      if (cachedLocations) {
        try {
          book.locations.load(cachedLocations);
          // A truncated table parses fine but leaves `total` at -1, which would
          // make every percentage NaN. Only trust a non-empty one.
          locationsReady = book.locations.length() > 0;
        } catch {
          locationsReady = false;
        }
      }

      // The content pipeline (registered above) styles chapter one on its first
      // render — no pre-display theming needed here.
      await rendition.display();

      if (locationsReady) return;

      // Cache miss. Resolve `attach` now and let locations finish in the
      // background (SPEC §8); until they do, `percent` is the spine estimate.
      void book.locations
        .generate(LOCATION_CHARS)
        .then(() => {
          locationsReady = true;
          if (options?.bookId) {
            try {
              writeCachedLocations(
                options.bookId,
                LOCATION_CHARS,
                book.locations.save(),
              );
            } catch {
              // Caching is an optimisation; failing to store must not stop the
              // reader from using the table it just built.
            }
          }
          try {
            const here = rendition?.currentLocation() as unknown;
            if (here && typeof here === "object" && "start" in here) {
              handleRelocated(here);
            }
          } catch {
            // currentLocation can throw mid-transition; the next `relocated`
            // event will carry the updated percent.
          }
        })
        .catch(() => {
          // locations are a progress nicety, not load-bearing — never surface.
        });
    },

    async next(source?: string): Promise<void> {
      // Logged BEFORE the turn so the rolling log keeps the state a skip
      // started from (DEFECTS.md D2).
      debugProbe?.logTurn("next", source);
      undriftForNextPage(rendition);
      await rendition?.next();
    },

    async prev(source?: string): Promise<void> {
      debugProbe?.logTurn("prev", source);
      const from = sectionIndexOf(rendition);
      await rendition?.prev();
      // epub.js scrolls to the chapter end itself; re-assert it from geometry
      // because that scroll can run against an unsettled width (D6). A frame
      // later the prepended view has its final size.
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => resolve());
        } else {
          resolve();
        }
      });
      snapBackToChapterEnd(rendition, from);
    },

    async goTo(target: string): Promise<void> {
      // `display` accepts a CFI or a spine href.
      await rendition?.display(target);
    },

    currentChapterLabel(): string | undefined {
      try {
        const here = rendition?.currentLocation() as
          | { start?: { href?: string } }
          | undefined;
        return chapterLabelForHref(here?.start?.href);
      } catch {
        return undefined;
      }
    },

    relayout(): void {
      if (relayoutTimer) clearTimeout(relayoutTimer);
      relayoutTimer = setTimeout(() => {
        relayoutTimer = undefined;
        if (!rendition) return;
        const next = spreadFor(viewportWidth(containerEl));
        currentSpread = next;
        // Let epub.js recompute columns/clip for the new spread.
        rendition.spread(next);
        // epub.js measures the container once and caches the pixel size, so a
        // container that changed height without a window resize (entering or
        // leaving immersive) keeps the old page height until it re-measures.
        try {
          // The CONTENT box, not the border box: any padding on the container
          // is outside the iframe, so measuring it tells epub.js the page is
          // bigger than it is and the columns stop matching what's visible.
          const box = contentBox(containerEl);
          if (box && box.width > 0 && box.height > 0) {
            // epub.js accepts a CFI as a third argument to hold the reader's
            // place across the re-measure; its own types stop at two.
            (
              rendition.resize as unknown as (
                w: number,
                h: number,
                cfi?: string,
              ) => void
            )(box.width, box.height, currentCfi());
          }
        } catch {
          // Mid-transition measurement — the next relayout will catch it.
        }
      }, 150);
    },

    applySettings(s: ReaderContentSettings): void {
      const prev = currentSettings;
      currentSettings = { ...s };
      // The content pipeline owns all content CSS — re-inject its stylesheet
      // (font / size / spacing / measure / Day-Night) into every live chapter.
      contentPipeline?.refresh();
      // A layout-affecting change (font, size, spacing, margins) needs epub.js
      // to re-flow the columns; a pure Day/Night swap does not (and re-flowing
      // it just adds a flash).
      const layoutChanged =
        prev.fontFamily !== s.fontFamily ||
        prev.fontSize !== s.fontSize ||
        prev.lineSpacing !== s.lineSpacing ||
        prev.margins !== s.margins;
      if (layoutChanged) scheduleReflow();
    },

    onRelocated(cb: (loc: ReaderLocation) => void): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    onSelected(cb: (sel: { cfiRange: string; text: string }) => void): () => void {
      selectionSubscribers.add(cb);
      return () => {
        selectionSubscribers.delete(cb);
      };
    },

    addHighlight(
      cfiRange: string,
      opts: { id: string; styles: Record<string, string>; onClick?: () => void },
    ): void {
      // A failed annotation must never break reading (SPEC §8).
      try {
        const cb = opts.onClick
          ? () => {
              try {
                opts.onClick?.();
              } catch {
                // swallow — a click handler must not bubble into epub.js
              }
            }
          : undefined;
        rendition?.annotations.add(
          "highlight",
          cfiRange,
          { id: opts.id },
          cb,
          `leaf-hl leaf-hl-${opts.id}`,
          opts.styles,
        );
      } catch {
        // ignore — highlight painting is best-effort
      }
    },

    removeHighlight(cfiRange: string): void {
      try {
        rendition?.annotations.remove(cfiRange, "highlight");
      } catch {
        // ignore — the annotation may already be gone
      }
    },

    clearSelection(): void {
      lastSelectionCfi = undefined;
      try {
        const contents = rendition?.getContents() as unknown;
        const list = Array.isArray(contents)
          ? contents
          : contents
            ? [contents]
            : [];
        for (const c of list) {
          try {
            (c as { window?: Window }).window?.getSelection?.()?.removeAllRanges();
          } catch {
            // ignore a single uncooperative iframe
          }
        }
      } catch {
        // ignore — nothing rendered yet
      }
    },

    get sectionCount(): number {
      return sectionCount;
    },

    debugSnapshot(): ReaderDebugSnapshot | null {
      try {
        return debugProbe?.snapshot() ?? null;
      } catch {
        return null;
      }
    },

    onDebug(cb: (snap: ReaderDebugSnapshot) => void): (() => void) | null {
      return debugProbe?.onChange(cb) ?? null;
    },

    destroy(): void {
      if (relayoutTimer) {
        clearTimeout(relayoutTimer);
        relayoutTimer = undefined;
      }
      if (redisplayTimer) {
        clearTimeout(redisplayTimer);
        redisplayTimer = undefined;
      }
      subscribers.clear();
      selectionSubscribers.clear();
      try {
        debugProbe?.destroy();
      } catch {
        // ignore probe teardown errors
      }
      debugProbe = undefined;
      try {
        contentPipeline?.destroy();
      } catch {
        // ignore pipeline teardown errors
      }
      contentPipeline = undefined;
      try {
        rendition?.destroy();
      } catch {
        // ignore
      }
      rendition = undefined;
      try {
        book.destroy();
      } catch {
        // ignore
      }
    },
  };

  return controller;
}
