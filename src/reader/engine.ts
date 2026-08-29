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

// --- Shared interface (Agents B & C code against these EXACT shapes) --------

export interface ReaderContentSettings {
  fontFamily: "serif" | "sans" | "legible";
  fontSize: number; // rem (default 1.06)
  lineSpacing: number; // default 1.62
  margins: "narrow" | "normal" | "wide";
  theme: "day" | "night";
}

export interface ReaderLocation {
  cfi: string;
  percent: number; // 0..1 via book.locations (0 until locations are ready)
  displayedPage?: number; // rendition.currentLocation().start.displayed.page
  totalPages?: number;
}

export interface ReaderController {
  attach(container: HTMLElement): Promise<void>; // renderTo + display + locations.generate
  next(): Promise<void>;
  prev(): Promise<void>;
  goTo(target: string): Promise<void>; // CFI or spine href
  relayout(): void; // recompute spread (call on resize; debounced inside)
  applySettings(s: ReaderContentSettings): void; // -> rendition.themes / font / override
  onRelocated(cb: (loc: ReaderLocation) => void): () => void; // returns an unsubscribe fn
  readonly sectionCount: number;
  destroy(): void;
}

// The content pipeline (normalizer hook + fine-press stylesheet + Day/Night
// theming of the book iframe) lives in `./content-hook` — same layer, allowed.
// Wired in `attach()` BEFORE the first `rendition.display()` so chapter one
// renders through it; refreshed on every settings change.
import { registerContentPipeline } from "./content-hook";

// --- Settings → CSS mapping ------------------------------------------------

// Family NAMES (not `--leaf-font-*` vars — the content iframe can't see the top
// document's custom properties). Matches the prototype's curated set.
const FONT_STACK: Record<ReaderContentSettings["fontFamily"], string> = {
  serif: "EB Garamond",
  sans: "Inter",
  legible: "Atkinson Hyperlegible",
};

// Concrete horizontal page margins, applied as body padding so epub.js measures
// the reduced content box and paginates against it.
const MARGIN_VALUES: Record<ReaderContentSettings["margins"], string> = {
  narrow: "4%",
  normal: "8%",
  wide: "13%",
};

// Content-theme palette — same values as the prototype's `[data-theme]` blocks.
// Exposed as concrete `color`/`background` plus the `--ink` / `--bg` / `--accent`
// custom properties Agent B's stylesheet reads for drop cap + lede accents.
const CONTENT_THEME: Record<
  ReaderContentSettings["theme"],
  { ink: string; bg: string; accent: string }
> = {
  day: { ink: "#26200f", bg: "#f1ebdc", accent: "#8a2b1e" },
  night: { ink: "#e0d5bd", bg: "#1a1611", accent: "#e0a03c" },
};

const SPREAD_MIN_WIDTH = 1024; // ≥ this → two-page spread, else single page

function spreadFor(width: number): "always" | "none" {
  return width >= SPREAD_MIN_WIDTH ? "always" : "none";
}

function viewportWidth(container: HTMLElement | undefined): number {
  const cw = container?.clientWidth ?? 0;
  if (cw > 0) return cw;
  return typeof window !== "undefined" ? window.innerWidth : SPREAD_MIN_WIDTH;
}

// --- Factory -------------------------------------------------------------

export async function createReader(
  bytes: ArrayBuffer,
  initial: ReaderContentSettings,
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
  let locationsReady = false;
  let currentSpread: "always" | "none" = "none";
  let relayoutTimer: ReturnType<typeof setTimeout> | undefined;

  const subscribers = new Set<(loc: ReaderLocation) => void>();

  function emit(loc: ReaderLocation): void {
    for (const cb of subscribers) {
      try {
        cb(loc);
      } catch {
        // a bad subscriber must not break relocation handling for the others
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

  function applySettingsToRendition(s: ReaderContentSettings): void {
    if (!rendition) return;
    const t = rendition.themes;
    t.font(FONT_STACK[s.fontFamily]);
    t.fontSize(`${s.fontSize}rem`);
    t.override("line-height", String(s.lineSpacing), true);

    const margin = MARGIN_VALUES[s.margins];
    t.override("padding-left", margin, true);
    t.override("padding-right", margin, true);

    const c = CONTENT_THEME[s.theme];
    t.override("color", c.ink, true);
    t.override("background", c.bg, true);
    t.override("--ink", c.ink, true);
    t.override("--bg", c.bg, true);
    t.override("--accent", c.accent, true);
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

      rendition.on("relocated", handleRelocated);

      // Theme the very first render.
      applySettingsToRendition(currentSettings);

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

    async next(): Promise<void> {
      await rendition?.next();
    },

    async prev(): Promise<void> {
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
      }, 150);
    },

    applySettings(s: ReaderContentSettings): void {
      currentSettings = { ...s };
      applySettingsToRendition(currentSettings);
      // Re-inject the pipeline's own stylesheet (font stack / size / spacing /
      // measure / Day-Night) into every live chapter.
      contentPipeline?.refresh();
    },

    onRelocated(cb: (loc: ReaderLocation) => void): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    get sectionCount(): number {
      return sectionCount;
    },

    destroy(): void {
      if (relayoutTimer) {
        clearTimeout(relayoutTimer);
        relayoutTimer = undefined;
      }
      subscribers.clear();
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
