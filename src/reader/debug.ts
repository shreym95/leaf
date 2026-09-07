// Reader debug probe — TEMPORARY on-device instrumentation for DEFECTS.md D2
// ("last page of a chapter is skipped on mobile"). LOGIC ONLY: style-agnostic,
// no imports from `src/design` or `src/components` (ESLint seam rule). It emits
// PLAIN DATA; the overlay that renders it lives in
// `src/components/reader-ui/ReaderDebugOverlay.tsx`.
//
// OBSERVE-ONLY. Nothing here may change pagination or layout:
//   - it reads geometry (`scrollLeft` / `offsetWidth` / `scrollWidth`, epub.js's
//     `layout.*`), which forces a measurement but never a mutation;
//   - it attaches image `load` listeners with `addEventListener`, NEVER
//     `img.onload = …` — epub.js itself assigns `img.onload = contents.expand`
//     (`epubjs/src/contents.js` `imageLoadListeners()`), so an assignment here
//     would silently delete its re-flow and *cause* a defect instead of
//     measuring one.
//
// The probe is created only when `createReader(..., { debug: true })` is asked
// for, which only happens behind `?debug=1` — a normal reader never builds it.
//
// THE LEAD IT EXISTS TO TEST. epub.js measures a section and computes its page
// count once. If an `<img>` in that section is still loading at that moment, the
// measurement is short and the final page can become unreachable — the manager's
// advance test (`epubjs/src/managers/default/index.js` `next()`)
//
//     scrollLeft + offsetWidth + delta <= scrollWidth   → scroll one page
//     else                                              → jump to the next section
//
// takes the `else` branch a page early. The harness served images from localhost
// (instant); a phone loads them over the network. So we record, per section, when
// the section was laid out, when each image finished, and what `scrollWidth` was
// on each side of that.

import type { Rendition } from "epubjs";

/** How many turn events the rolling log keeps. */
export const DEBUG_TURN_LOG_SIZE = 12;

/** How long to wait for a `relocated` after a turn before logging it as "no move". */
const TURN_SETTLE_MS = 700;

/** Delay before re-reading `scrollWidth` after a late image load, so epub.js's
 *  own `expand()` (fired from its `img.onload`) has had a frame to run. */
const LATE_IMAGE_SETTLE_MS = 60;

export interface ReaderDebugBox {
  width: number;
  height: number;
}

export interface ReaderDebugContainer {
  scrollLeft: number;
  offsetWidth: number;
  scrollWidth: number;
  clientWidth: number;
  offsetHeight: number;
}

export interface ReaderDebugLayout {
  delta: number | null;
  pageWidth: number | null;
  columnWidth: number | null;
  gap: number | null;
  height: number | null;
  width: number | null;
  divisor: number | null;
}

export interface ReaderDebugView {
  iframeWidth: number | null;
  iframeHeight: number | null;
  elementWidth: number | null;
  /** `view.width()` — what epub.js believes the section is. */
  reportedWidth: number | null;
  /** The chapter document's own `scrollWidth`, inside the iframe. */
  bodyScrollWidth: number | null;
}

export interface ReaderDebugImages {
  /** `<img>` elements in the current section. */
  total: number;
  /** How many of them report `complete === true` right now. */
  complete: number;
  /** How many finished loading AFTER the section was first laid out. */
  loadedAfterLayout: number;
  /** ms between the section's layout and the last late image finishing. */
  lastLateMs: number | null;
  /** `container.scrollWidth` at the moment the section was laid out. */
  scrollWidthAtLayout: number | null;
  /** `container.scrollWidth` after the last late image settled. Different from
   *  `scrollWidthAtLayout` ⇒ the page count computed at layout was stale. */
  scrollWidthAfterImages: number | null;
}

export interface ReaderDebugPosition {
  section: number | null;
  page: number | null;
  total: number | null;
}

export interface ReaderDebugTurn {
  n: number;
  /** What the reader touched: "tap-next", "bar-prev", "key-right"… */
  source: string;
  dir: "next" | "prev";
  before: ReaderDebugPosition & {
    scrollLeft: number | null;
    offsetWidth: number | null;
    scrollWidth: number | null;
    delta: number | null;
    /** epub.js's own advance test, evaluated on the BEFORE state. */
    canAdvance: boolean | null;
  };
  /** null ⇒ no `relocated` followed the turn within `TURN_SETTLE_MS`. */
  after: ReaderDebugPosition | null;
  /** The D2 signature: the section changed while pages remained in the old one. */
  skipped: boolean;
}

export interface ReaderDebugSnapshot {
  atMs: number;
  section: number | null;
  href: string | null;
  page: number | null;
  total: number | null;
  cfi: string | null;
  spread: string;
  container: ReaderDebugContainer | null;
  layout: ReaderDebugLayout | null;
  /** What `relayout()` would hand `rendition.resize()` right now. */
  measuredBox: ReaderDebugBox | null;
  view: ReaderDebugView | null;
  /** `scrollLeft + offsetWidth + delta`. */
  advanceLeft: number | null;
  /** `advanceLeft <= scrollWidth` — true ⇒ epub.js scrolls a page rather than
   *  jumping to the next section. */
  canAdvance: boolean | null;
  images: ReaderDebugImages;
  /** Newest first, capped at `DEBUG_TURN_LOG_SIZE`. */
  turns: ReaderDebugTurn[];
}

export interface ReaderDebugProbe {
  snapshot(): ReaderDebugSnapshot;
  /** Record the state a turn started from. Call BEFORE awaiting the turn. */
  logTurn(dir: "next" | "prev", source?: string): void;
  onChange(cb: (snap: ReaderDebugSnapshot) => void): () => void;
  destroy(): void;
}

// --- loose readers -------------------------------------------------------
// epub.js internals are untyped across versions; every read is defensive and a
// missing field surfaces as `null` rather than throwing into the reader.

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

interface ViewLike {
  section?: { index?: number; href?: string };
  iframe?: HTMLIFrameElement | null;
  element?: HTMLElement | null;
  contents?: { document?: Document } | null;
  width?: () => number;
}

interface ManagerLike {
  container?: HTMLElement;
  layout?: Record<string, unknown>;
  views?: { _views?: ViewLike[]; last?: () => ViewLike | undefined };
}

function managerOf(rendition: Rendition): ManagerLike | undefined {
  return (rendition as unknown as { manager?: ManagerLike }).manager;
}

function layoutOf(rendition: Rendition): Record<string, unknown> | undefined {
  return (
    managerOf(rendition)?.layout ??
    (rendition as unknown as { _layout?: Record<string, unknown> })._layout
  );
}

function viewsOf(rendition: Rendition): ViewLike[] {
  const views = managerOf(rendition)?.views;
  if (!views) return [];
  if (Array.isArray(views._views)) return views._views;
  const last = views.last?.();
  return last ? [last] : [];
}

/** The view for `index`, else the last rendered one. */
function viewFor(rendition: Rendition, index: number | null): ViewLike | undefined {
  const views = viewsOf(rendition);
  if (index != null) {
    const match = views.find((v) => v?.section?.index === index);
    if (match) return match;
  }
  return views[views.length - 1];
}

function imagesIn(doc: Document | null | undefined): HTMLImageElement[] {
  if (!doc) return [];
  try {
    return Array.from(doc.querySelectorAll("img"));
  } catch {
    return [];
  }
}

// --- factory -------------------------------------------------------------

export function createDebugProbe(opts: {
  rendition: Rendition;
  /** The engine's own container measurement — literally what `relayout()` passes. */
  measure: () => ReaderDebugBox | null;
  getSpread: () => string;
}): ReaderDebugProbe {
  const { rendition, measure, getSpread } = opts;

  /** Per-section image/layout timing, keyed by spine index. */
  interface SectionRec {
    contentAtMs: number;
    layoutAtMs: number | null;
    scrollWidthAtLayout: number | null;
    loadedAfterLayout: number;
    lastLateMs: number | null;
    scrollWidthAfterImages: number | null;
    doc: Document | null;
  }

  const sections = new Map<number, SectionRec>();
  const subscribers = new Set<(snap: ReaderDebugSnapshot) => void>();
  const turns: ReaderDebugTurn[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();

  let lastLocation: {
    section: number | null;
    href: string | null;
    page: number | null;
    total: number | null;
    cfi: string | null;
  } = { section: null, href: null, page: null, total: null, cfi: null };

  let turnSeq = 0;
  let pendingTurn: ReaderDebugTurn | undefined;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  function later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!destroyed) fn();
    }, ms);
    timers.add(t);
  }

  function containerEl(): HTMLElement | undefined {
    return managerOf(rendition)?.container;
  }

  function readContainer(): ReaderDebugContainer | null {
    const el = containerEl();
    if (!el) return null;
    try {
      return {
        scrollLeft: el.scrollLeft,
        offsetWidth: el.offsetWidth,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        offsetHeight: el.offsetHeight,
      };
    } catch {
      return null;
    }
  }

  function containerScrollWidth(): number | null {
    try {
      return num(containerEl()?.scrollWidth);
    } catch {
      return null;
    }
  }

  function readLayout(): ReaderDebugLayout | null {
    const l = layoutOf(rendition);
    if (!l) return null;
    return {
      delta: num(l.delta),
      pageWidth: num(l.pageWidth),
      columnWidth: num(l.columnWidth),
      gap: num(l.gap),
      height: num(l.height),
      width: num(l.width),
      divisor: num(l.divisor),
    };
  }

  function readView(view: ViewLike | undefined): ReaderDebugView | null {
    if (!view) return null;
    let iframeWidth: number | null = null;
    let iframeHeight: number | null = null;
    let elementWidth: number | null = null;
    let reportedWidth: number | null = null;
    let bodyScrollWidth: number | null = null;
    try {
      const rect = view.iframe?.getBoundingClientRect();
      iframeWidth = num(rect?.width);
      iframeHeight = num(rect?.height);
    } catch {
      /* mid-teardown */
    }
    try {
      elementWidth = num(view.element?.offsetWidth);
    } catch {
      /* mid-teardown */
    }
    try {
      reportedWidth = num(view.width?.());
    } catch {
      /* epub.js can throw before the view is sized */
    }
    try {
      const doc = view.contents?.document;
      bodyScrollWidth = num(doc?.documentElement?.scrollWidth);
    } catch {
      /* cross-document access can throw mid-swap */
    }
    return { iframeWidth, iframeHeight, elementWidth, reportedWidth, bodyScrollWidth };
  }

  function readImages(index: number | null, view: ViewLike | undefined): ReaderDebugImages {
    const rec = index != null ? sections.get(index) : undefined;
    const doc = view?.contents?.document ?? rec?.doc ?? null;
    const imgs = imagesIn(doc);
    let complete = 0;
    for (const img of imgs) {
      try {
        if (img.complete) complete += 1;
      } catch {
        /* ignore a single uncooperative node */
      }
    }
    return {
      total: imgs.length,
      complete,
      loadedAfterLayout: rec?.loadedAfterLayout ?? 0,
      lastLateMs: rec?.lastLateMs ?? null,
      scrollWidthAtLayout: rec?.scrollWidthAtLayout ?? null,
      scrollWidthAfterImages: rec?.scrollWidthAfterImages ?? null,
    };
  }

  function snapshot(): ReaderDebugSnapshot {
    const container = readContainer();
    const layout = readLayout();
    const view = viewFor(rendition, lastLocation.section);

    const delta = layout?.delta ?? null;
    const advanceLeft =
      container && delta != null
        ? container.scrollLeft + container.offsetWidth + delta
        : null;

    return {
      atMs: now(),
      section: lastLocation.section ?? view?.section?.index ?? null,
      href: lastLocation.href ?? view?.section?.href ?? null,
      page: lastLocation.page,
      total: lastLocation.total,
      cfi: lastLocation.cfi,
      spread: getSpread(),
      container,
      layout,
      measuredBox: (() => {
        try {
          return measure();
        } catch {
          return null;
        }
      })(),
      view: readView(view),
      advanceLeft,
      canAdvance:
        advanceLeft != null && container ? advanceLeft <= container.scrollWidth : null,
      images: readImages(lastLocation.section, view),
      turns: turns.slice().reverse(),
    };
  }

  function emit(): void {
    if (destroyed || subscribers.size === 0) return;
    let snap: ReaderDebugSnapshot;
    try {
      snap = snapshot();
    } catch {
      return;
    }
    for (const cb of subscribers) {
      try {
        cb(snap);
      } catch {
        // a bad subscriber must never break the probe for the others
      }
    }
  }

  function flushPendingTurn(after: ReaderDebugPosition | null): void {
    if (!pendingTurn) return;
    const entry = pendingTurn;
    pendingTurn = undefined;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      timers.delete(pendingTimer);
      pendingTimer = undefined;
    }
    entry.after = after;
    entry.skipped =
      after != null &&
      entry.dir === "next" &&
      entry.before.section != null &&
      after.section != null &&
      after.section !== entry.before.section &&
      entry.before.page != null &&
      entry.before.total != null &&
      entry.before.page < entry.before.total;
    turns.push(entry);
    while (turns.length > DEBUG_TURN_LOG_SIZE) turns.shift();
    emit();
  }

  // --- rendition wiring --------------------------------------------------

  function onRelocated(raw: unknown): void {
    const loc = raw as
      | {
          start?: {
            cfi?: string;
            index?: number;
            href?: string;
            displayed?: { page?: number; total?: number };
          };
        }
      | undefined;
    const start = loc?.start;
    lastLocation = {
      section: num(start?.index),
      href: typeof start?.href === "string" ? start.href : null,
      page: num(start?.displayed?.page),
      total: num(start?.displayed?.total),
      cfi: typeof start?.cfi === "string" ? start.cfi : null,
    };
    if (pendingTurn) {
      flushPendingTurn({
        section: lastLocation.section,
        page: lastLocation.page,
        total: lastLocation.total,
      });
    } else {
      emit();
    }
  }

  function onRendered(rawSection: unknown): void {
    const index = num((rawSection as { index?: number } | undefined)?.index);
    if (index == null) return;
    const rec = sections.get(index);
    if (rec) {
      rec.layoutAtMs = now();
      rec.scrollWidthAtLayout = containerScrollWidth();
    }
    emit();
  }

  /** Content hook — observe the section's images. Registered AFTER the content
   *  pipeline, so the DOM we scan is the normalised one the reader actually sees. */
  function onContent(raw: unknown): void {
    const contents = raw as
      | { document?: Document; sectionIndex?: number }
      | undefined;
    const doc = contents?.document;
    const index = num(contents?.sectionIndex);
    if (!doc || index == null) return;

    const rec: SectionRec = {
      contentAtMs: now(),
      layoutAtMs: null,
      scrollWidthAtLayout: null,
      loadedAfterLayout: 0,
      lastLateMs: null,
      scrollWidthAfterImages: null,
      doc,
    };
    sections.set(index, rec);

    for (const img of imagesIn(doc)) {
      let done = false;
      const settle = () => {
        if (done || destroyed) return;
        done = true;
        const at = now();
        // `layoutAtMs === null` ⇒ the section had not finished laying out yet,
        // so this image is NOT late — it is part of the first measurement.
        if (rec.layoutAtMs != null && at > rec.layoutAtMs) {
          rec.loadedAfterLayout += 1;
          rec.lastLateMs = at - rec.layoutAtMs;
          // Re-read after a frame: epub.js's own `img.onload` → `expand()` runs
          // in the same tick, and its effect on `scrollWidth` is the datum.
          later(() => {
            rec.scrollWidthAfterImages = containerScrollWidth();
            emit();
          }, LATE_IMAGE_SETTLE_MS);
        }
        emit();
      };
      try {
        if (img.complete) continue;
        // addEventListener, NOT `img.onload =` — see the header note.
        img.addEventListener("load", settle, { once: true });
        img.addEventListener("error", settle, { once: true });
      } catch {
        /* a node we cannot observe is simply not observed */
      }
    }
    emit();
  }

  function onResized(): void {
    emit();
  }

  try {
    rendition.on("relocated", onRelocated);
    rendition.on("rendered", onRendered);
    rendition.on("resized", onResized);
    rendition.on("layout", onResized);
  } catch {
    /* an event epub.js does not emit is simply never heard */
  }
  try {
    rendition.hooks.content.register(onContent);
  } catch {
    /* without the hook we still report geometry, just not image timing */
  }

  return {
    snapshot,

    logTurn(dir: "next" | "prev", source?: string): void {
      if (destroyed) return;
      // A turn fired before the previous one settled: log the old one as unmoved.
      if (pendingTurn) flushPendingTurn(null);
      let snap: ReaderDebugSnapshot;
      try {
        snap = snapshot();
      } catch {
        return;
      }
      turnSeq += 1;
      pendingTurn = {
        n: turnSeq,
        source: source ?? dir,
        dir,
        before: {
          section: snap.section,
          page: snap.page,
          total: snap.total,
          scrollLeft: snap.container?.scrollLeft ?? null,
          offsetWidth: snap.container?.offsetWidth ?? null,
          scrollWidth: snap.container?.scrollWidth ?? null,
          delta: snap.layout?.delta ?? null,
          canAdvance: snap.canAdvance,
        },
        after: null,
        skipped: false,
      };
      pendingTimer = setTimeout(() => {
        if (pendingTimer) timers.delete(pendingTimer);
        pendingTimer = undefined;
        flushPendingTurn(null);
      }, TURN_SETTLE_MS);
      timers.add(pendingTimer);
    },

    onChange(cb: (snap: ReaderDebugSnapshot) => void): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    destroy(): void {
      destroyed = true;
      subscribers.clear();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      pendingTurn = undefined;
      pendingTimer = undefined;
      sections.clear();
      try {
        rendition.off("relocated", onRelocated);
        rendition.off("rendered", onRendered);
        rendition.off("resized", onResized);
        rendition.off("layout", onResized);
      } catch {
        /* already torn down */
      }
      try {
        rendition.hooks.content.deregister(onContent);
      } catch {
        /* hook list already cleared by rendition.destroy() */
      }
    },
  };
}
