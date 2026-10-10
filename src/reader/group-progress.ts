// Group read progress reporting (GROUPS_V1_BUILD.md L1, L5, L6). LOGIC ONLY — no
// design/component imports.
//
// When the open book is linked to a group read, the reader's position is mapped
// into the read's outline (chapter + fraction) and queued on the `group-progress`
// outbox. The outbox owns delivery, so nothing here awaits the network on the
// reading path, and every failure is swallowed the way position.ts swallows
// write errors: this module can never interrupt reading or position saving.

import { createClient } from "@/lib/supabase/client";
import { findReadForBook, outlinePercent, type BookRead } from "@/lib/db/groups";
import { toOutlinePosition } from "@/lib/groups/alignment";
import { GROUPS_ENABLED } from "@/lib/groups/flag";
import { enqueueGroupProgress, resolveUserId } from "@/lib/offline/outbox";
import type { ReaderController, ReaderLocation } from "./engine";

export interface GroupProgressTracker {
  stop(): void;
}

type AuthClient = Parameters<typeof resolveUserId>[0];
type DbClient = Parameters<typeof findReadForBook>[2];

export interface GroupProgressOptions {
  bookId: string;
  /** Defaults to the browser client, created only once groups are known to be on. */
  supabase?: AuthClient & DbClient;
  /** Same cadence as the position write (position.ts). */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 1500;

const NOOP_TRACKER: GroupProgressTracker = { stop() {} };

function pathOf(href: string): string {
  const i = href.indexOf("#");
  return i === -1 ? href : href.slice(0, i);
}

function lastSegment(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/**
 * The mapped TOC href of the member's copy that `spineHref` belongs to: the same
 * path (fragment ignored), else the only mapped file with the same final path
 * segment. Null when neither exists — the caller then skips the update rather than
 * guessing a chapter.
 */
function resolveCopyHref(
  alignment: NonNullable<BookRead["copy"]["alignment"]>,
  spineHref: string,
): string | null {
  const mapped = alignment.copyHrefs.filter((h) => alignment.map[h] !== undefined);
  const path = pathOf(spineHref);

  const exact = mapped.find((h) => pathOf(h) === path);
  if (exact !== undefined) return exact;

  const base = lastSegment(path);
  if (!base) return null;
  const sameName = mapped.filter((h) => lastSegment(pathOf(h)) === base);
  if (sameName.length === 0) return null;
  const distinctPaths = new Set(sameName.map(pathOf));
  return distinctPaths.size === 1 ? sameName[0] : null;
}

export function trackGroupProgress(
  controller: ReaderController,
  opts: GroupProgressOptions,
): GroupProgressTracker {
  // L1: with groups off nothing below runs — no client, no query, no listener.
  if (!GROUPS_ENABLED) return NOOP_TRACKER;

  try {
    return start(controller, opts);
  } catch {
    return NOOP_TRACKER;
  }
}

function start(
  controller: ReaderController,
  opts: GroupProgressOptions,
): GroupProgressTracker {
  const { bookId } = opts;
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let stopped = false;
  let userId: string | undefined;
  let reads: BookRead[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { spineHref: string; sectionFraction: number } | undefined;
  const lastSent = new Map<string, string>();

  function flush(): void {
    try {
      if (!pending || !userId || !reads) return;
      const { spineHref, sectionFraction } = pending;
      pending = undefined;
      for (const { read, copy } of reads) {
        if (!copy.alignment) continue;
        const copyHref = resolveCopyHref(copy.alignment, spineHref);
        if (copyHref === null) continue;
        const position = toOutlinePosition(
          copy.alignment,
          read.outline,
          copyHref,
          sectionFraction,
        );
        const key = `${position.chapterIndex}:${position.chapterFraction}`;
        if (lastSent.get(read.id) === key) continue;
        lastSent.set(read.id, key);
        // finishedAt stays null: milestones are the source of truth for "finished".
        enqueueGroupProgress({
          userId,
          readId: read.id,
          chapterIndex: position.chapterIndex,
          chapterFraction: position.chapterFraction,
          percent: outlinePercent(read.outline.length, position),
          finishedAt: null,
        }).catch(() => {});
      }
    } catch {
      // Best-effort, as position writes are.
    }
  }

  function flushNow(): void {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    flush();
  }

  function onVisibilityChange(): void {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      flushNow();
    }
  }
  function onPageHide(): void {
    flushNow();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
  }

  const unsubscribe = controller.onRelocated((loc: ReaderLocation) => {
    try {
      if (stopped) return;
      if (loc.spineHref === undefined || loc.sectionFraction === undefined) return;
      pending = { spineHref: loc.spineHref, sectionFraction: loc.sectionFraction };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        flush();
      }, debounceMs);
    } catch {
      // never into the reader
    }
  });

  // Offline at start: no-op for this session (v1).
  void (async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const supabase = opts.supabase ?? createClient();
      const id = await resolveUserId(supabase);
      if (!id || stopped) return;
      const found = await findReadForBook(id, bookId, supabase);
      if (stopped || found.length === 0) return;
      userId = id;
      reads = found;
      // A page turn that landed before the lookup finished is not lost.
      if (pending && !timer) flush();
    } catch {
      // No reads, or the lookup failed: stay a no-op.
    }
  })();

  return {
    stop(): void {
      if (stopped) return;
      try {
        // Flush the last debounced position before going quiet.
        flushNow();
      } finally {
        stopped = true;
        try {
          unsubscribe();
        } catch {
          // ignore
        }
        if (typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", onVisibilityChange);
        }
        if (typeof window !== "undefined") {
          window.removeEventListener("pagehide", onPageHide);
        }
      }
    },
  };
}
