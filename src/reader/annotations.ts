// Reader annotation manager (NOTES_PLAN N1c, guarantee N5). LOGIC ONLY — no
// design / component imports (ESLint seam rule).
//
// One manager for the book's personal notes:
//   - page marks (`kind: "page"`, the old bookmark) — a position, nothing painted;
//   - quoted ranges (`kind: "range"`, the old highlight) — painted on the rendition.
// It replaces `./bookmarks.ts` and `./highlights.ts` in behaviour. Those files stay
// until NOTES Phase 2 removes them.
//
// Writes are optimistic: state changes first, then the injected `writer` is called.
// A writer that throws or rejects is swallowed, so the item stays listed and painted
// for the session. A controller that throws is swallowed the same way. Reading is
// never affected (N5).
//
// Persistence is injected (`load`, `writer`), so this module does not depend on the
// outbox or on Supabase. Colour is injected too: `stylesFor()` is supplied by the
// caller (the design layer), so no hex value lives here.

import type { ReaderController } from "./engine";
import {
  validateAnnotationNote,
  validateAnnotationQuote,
} from "@/lib/db/annotations";
import type { Annotation } from "@/lib/types";

export interface AnnotationWriter {
  create(a: Annotation): Promise<void> | void;
  setNote(id: string, note: string | null): Promise<void> | void;
  remove(id: string): Promise<void> | void;
}

export interface AnnotationManagerOptions {
  controller: ReaderController;
  bookId: string;
  userId: string;
  /** Every annotation for the book (the browser client + RLS in production). */
  load: () => Promise<Annotation[]>;
  writer: AnnotationWriter;
  /** Concrete epub.js annotation styles for a range. Supplied by the design layer. */
  stylesFor: () => Record<string, string>;
  /** Id generator. Defaults to `crypto.randomUUID()`. */
  newId?: () => string;
  /** Called with a copy of the range when its painted highlight is tapped. */
  onHighlightTap?: (a: Annotation) => void;
}

export interface PageMarkInput {
  cfi: string;
  label?: string | null;
  percent?: number | null;
}

export interface HighlightInput {
  cfiRange: string;
  quote: string;
  label?: string | null;
  percent?: number | null;
}

export interface AnnotationManager {
  /** Load the book's annotations, paint its ranges, and notify subscribers. */
  restore(): Promise<Annotation[]>;
  /** Subscribe to the in-memory list changing. Returns the unsubscribe function. */
  subscribe(listener: (list: Annotation[]) => void): () => void;
  /** Snapshot sorted by position in the book. Page marks and ranges share one order. */
  list(): Annotation[];
  /**
   * Toggle a page mark at `cfi`. Creates one when none exists at that CFI; removes
   * the existing one when it does. Resolves with the created mark, or `null` when
   * it removed one. Resolves after the write attempt settles.
   */
  markPage(input: PageMarkInput): Promise<Annotation | null>;
  /** True when a page mark exists at exactly this CFI. */
  isMarked(cfi: string): boolean;
  /**
   * Create a range highlight and paint it. If the new range overlaps an existing
   * range highlight, nothing is created and that existing highlight is returned.
   * Resolves `null` only after `destroy()`. Rejects with `RangeError` on an empty
   * or over-long quote, before any state change.
   */
  highlight(input: HighlightInput): Promise<Annotation | null>;
  /**
   * Set (or clear, with `null`) a note. Rejects with `RangeError` unless the note
   * is null or 1–500 characters, before any state change. Unknown ids are a no-op.
   */
  setNote(id: string, note: string | null): Promise<void>;
  /** Remove an annotation and un-paint its range. Unknown ids are a no-op. */
  remove(id: string): Promise<void>;
  /** Re-apply `stylesFor()` to every painted range (theme change). */
  repaint(): void;
  /** Un-paint every range, clear subscribers, and turn later mutations into no-ops. */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// CFI ordering and overlap. Pure, no epub.js import: the controller exposes no
// CFI compare, so positions are read from the CFI text. Each CFI is reduced to
// its integer steps and offsets, and those are compared in order. A range
// `epubcfi(P,S,E)` spans `P+S` to `P+E`. Assertions `[...]` are ignored.
// ---------------------------------------------------------------------------

interface CfiSpan {
  start: number[];
  end: number[];
}

function cfiSpan(cfi: string): CfiSpan | null {
  const m = /^epubcfi\((.*)\)$/.exec(cfi.trim());
  if (!m) return null;
  const parts = m[1].replace(/\[[^\]]*\]/g, "").split(",");
  const nums = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number);
  if (parts.length === 1) {
    const p = nums(parts[0]);
    return p.length > 0 ? { start: p, end: p } : null;
  }
  if (parts.length === 3) {
    const base = nums(parts[0]);
    const start = [...base, ...nums(parts[1])];
    const end = [...base, ...nums(parts[2])];
    return start.length > 0 && end.length > 0 ? { start, end } : null;
  }
  return null;
}

function compareSteps(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Orders two CFIs by where they point in the book: start first, then end. A CFI
 * that cannot be parsed falls back to plain string order, so the sort stays total.
 */
export function compareCfi(a: string, b: string): number {
  const sa = cfiSpan(a);
  const sb = cfiSpan(b);
  if (!sa || !sb) return compareText(a, b);
  return compareSteps(sa.start, sb.start) || compareSteps(sa.end, sb.end);
}

/**
 * True when two ranges share at least one position. Ends are inclusive, so ranges
 * that touch at a single point count as overlapping. An unparseable CFI matches
 * only an identical string.
 */
export function cfisOverlap(a: string, b: string): boolean {
  const sa = cfiSpan(a);
  const sb = cfiSpan(b);
  if (!sa || !sb) return a === b;
  return compareSteps(sa.start, sb.end) <= 0 && compareSteps(sb.start, sa.end) <= 0;
}

function defaultNewId(): string {
  return crypto.randomUUID();
}

export function createAnnotationManager(
  opts: AnnotationManagerOptions,
): AnnotationManager {
  const { controller, bookId, userId, load, writer, stylesFor, onHighlightTap } =
    opts;
  const newId = opts.newId ?? defaultNewId;

  // Creation order. `list()` sorts a copy by position.
  let items: Annotation[] = [];
  let destroyed = false;
  // id -> cfiRange for every range currently painted on the rendition.
  const painted = new Map<string, string>();
  const subscribers = new Set<(list: Annotation[]) => void>();
  // Set while `restore()` awaits `load()`. Ids removed in that window are dropped
  // from the loaded rows, so a removal is not undone by the restore.
  let restoring = false;
  const removedDuringRestore = new Set<string>();

  function snapshot(): Annotation[] {
    return items.map((a) => ({ ...a }));
  }

  function notify(): void {
    const list = sortedSnapshot();
    for (const cb of subscribers) {
      try {
        cb(list);
      } catch {
        // a bad subscriber must not break the others
      }
    }
  }

  function sortedSnapshot(): Annotation[] {
    return [...items]
      .sort(
        (x, y) =>
          compareCfi(x.cfi, y.cfi) ||
          (x.kind === y.kind ? 0 : x.kind === "page" ? -1 : 1),
      )
      .map((a) => ({ ...a }));
  }

  function unpaint(cfiRange: string): void {
    try {
      controller.removeHighlight(cfiRange);
    } catch {
      // best-effort: the annotation may already be gone from the rendition
    }
  }

  function paint(a: Annotation): void {
    try {
      controller.addHighlight(a.cfi, {
        id: a.id,
        styles: stylesFor(),
        onClick: onHighlightTap ? () => tap(a.id) : undefined,
      });
    } catch {
      // best-effort: painting must never break reading
    }
  }

  function tap(id: string): void {
    if (!onHighlightTap) return;
    const current = items.find((a) => a.id === id);
    if (!current) return;
    try {
      onHighlightTap({ ...current });
    } catch {
      // a click handler must not bubble into epub.js
    }
  }

  // Brings the painted ranges in line with `items`: un-paints what is gone and
  // paints what is new. Page marks are never painted.
  function syncPaint(): void {
    if (destroyed) return;
    const wanted = new Map<string, string>();
    for (const a of items) if (a.kind === "range") wanted.set(a.id, a.cfi);
    for (const [id, cfi] of painted) {
      if (wanted.get(id) !== cfi) {
        unpaint(cfi);
        painted.delete(id);
      }
    }
    for (const a of items) {
      if (a.kind === "range" && !painted.has(a.id)) {
        paint(a);
        painted.set(a.id, a.cfi);
      }
    }
  }

  function makeItem(
    kind: Annotation["kind"],
    cfi: string,
    quote: string | null,
    label: string | null | undefined,
    percent: number | null | undefined,
  ): Annotation {
    const now = new Date().toISOString();
    return {
      id: newId(),
      user_id: userId,
      book_id: bookId,
      kind,
      cfi,
      quote,
      note: null,
      label: label ?? null,
      percent: percent ?? null,
      created_at: now,
      updated_at: now,
    };
  }

  // The write is best-effort. The optimistic state already stands for this
  // session, and the error is never rethrown into the reader.
  async function persist(op: () => Promise<void> | void): Promise<void> {
    try {
      await op();
    } catch {
      // best-effort: a failed write leaves the optimistic state in place
    }
  }

  return {
    async restore(): Promise<Annotation[]> {
      if (destroyed) return snapshot();
      restoring = true;
      removedDuringRestore.clear();
      let loaded: Annotation[] | null = null;
      try {
        loaded = await load();
      } catch {
        // best-effort: keep whatever we already have
      }
      restoring = false;
      if (loaded && !destroyed) {
        const local = new Map(items.map((a) => [a.id, a] as const));
        const loadedIds = new Set(loaded.map((a) => a.id));
        const fromServer = loaded
          .filter((a) => !removedDuringRestore.has(a.id))
          .map((a) => local.get(a.id) ?? { ...a });
        const localOnly = items.filter((a) => !loadedIds.has(a.id));
        items = [...fromServer, ...localOnly];
        syncPaint();
      }
      removedDuringRestore.clear();
      notify();
      return sortedSnapshot();
    },

    subscribe(listener: (list: Annotation[]) => void): () => void {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },

    list(): Annotation[] {
      return sortedSnapshot();
    },

    async markPage(input: PageMarkInput): Promise<Annotation | null> {
      if (destroyed) return null;
      const existing = items.find(
        (a) => a.kind === "page" && a.cfi === input.cfi,
      );
      if (existing) {
        items = items.filter((a) => a.id !== existing.id);
        if (restoring) removedDuringRestore.add(existing.id);
        syncPaint();
        notify();
        await persist(() => writer.remove(existing.id));
        return null;
      }
      const mark = makeItem(
        "page",
        input.cfi,
        null,
        input.label,
        input.percent,
      );
      items = [...items, mark];
      syncPaint();
      notify();
      await persist(() => writer.create({ ...mark }));
      return { ...mark };
    },

    isMarked(cfi: string): boolean {
      return items.some((a) => a.kind === "page" && a.cfi === cfi);
    },

    async highlight(input: HighlightInput): Promise<Annotation | null> {
      if (destroyed) return null;
      validateAnnotationQuote("range", input.quote);
      const overlapping = items.find(
        (a) => a.kind === "range" && cfisOverlap(a.cfi, input.cfiRange),
      );
      if (overlapping) return { ...overlapping };
      const range = makeItem(
        "range",
        input.cfiRange,
        input.quote,
        input.label,
        input.percent,
      );
      items = [...items, range];
      syncPaint();
      notify();
      await persist(() => writer.create({ ...range }));
      return { ...range };
    },

    async setNote(id: string, note: string | null): Promise<void> {
      validateAnnotationNote(note);
      if (destroyed) return;
      if (!items.some((a) => a.id === id)) return;
      const now = new Date().toISOString();
      items = items.map((a) =>
        a.id === id ? { ...a, note, updated_at: now } : a,
      );
      notify();
      await persist(() => writer.setNote(id, note));
    },

    async remove(id: string): Promise<void> {
      if (destroyed) return;
      if (!items.some((a) => a.id === id)) return;
      items = items.filter((a) => a.id !== id);
      if (restoring) removedDuringRestore.add(id);
      syncPaint();
      notify();
      await persist(() => writer.remove(id));
    },

    repaint(): void {
      if (destroyed) return;
      for (const a of items) {
        if (a.kind !== "range" || !painted.has(a.id)) continue;
        unpaint(a.cfi);
        paint(a);
      }
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const cfi of painted.values()) unpaint(cfi);
      painted.clear();
      subscribers.clear();
    },
  };
}
