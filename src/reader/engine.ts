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
  percent: number; // 0..1 via book.locations (0 until locations are ready)
  displayedPage?: number; // rendition.currentLocation().start.displayed.page
  totalPages?: number;
}

export interface ReaderController {
  attach(container: HTMLElement): Promise<void>; // renderTo + display + locations.generate
  /** `source` is debug-only bookkeeping (which control was used); ignored otherwise. */
  next(source?: string): Promise<void>;
  prev(source?: string): Promise<void>;
  goTo(target: string): Promise<void>; // CFI or spine href
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

// All book-content styling (fonts, size, spacing, margins, Day/Night) is owned
// by the content pipeline (`./content-hook`) — it injects one authoritative
// `<style>` per chapter. The engine just tells it to refresh and re-flows.

const SPREAD_MIN_WIDTH = 1024; // ≥ this → two-page spread, else single page

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
      start?: { cfi?: string; displayed?: { page?: number; total?: number } };
      cfi?: string;
    };
    const cfi = loc?.start?.cfi ?? loc?.cfi;
    if (!cfi) return;
    lastKnownCfi = cfi;

    let percent = 0;
    if (locationsReady) {
      const p = book.locations.percentageFromCfi(cfi);
      percent = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
    }

    emit({
      cfi,
      percent,
      displayedPage: loc?.start?.displayed?.page,
      totalPages: loc?.start?.displayed?.total,
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

      // The content pipeline (registered above) styles chapter one on its first
      // render — no pre-display theming needed here.
      await rendition.display();

      // Resolve `attach` now; let locations finish in the background and start
      // emitting real `percent` once ready (SPEC §8). Until then `percent` is 0.
      void book.locations
        .generate(1200)
        .then(() => {
          locationsReady = true;
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
      await rendition?.next();
    },

    async prev(source?: string): Promise<void> {
      debugProbe?.logTurn("prev", source);
      await rendition?.prev();
    },

    async goTo(target: string): Promise<void> {
      // `display` accepts a CFI or a spine href.
      await rendition?.display(target);
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
