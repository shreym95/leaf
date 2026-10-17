// Outbox-first writer for personal annotations. LOGIC ONLY — no design/component
// imports.
//
// Every create, note and delete is validated, then enqueued (durable in IndexedDB),
// and only then does a flush go to the network while online. Nothing here calls
// Supabase directly, so a write in flight when the tab closes is still in the outbox
// and replays on the next start.
//
// Validation runs synchronously: an invalid value throws RangeError to the caller
// and is never enqueued.
//
// Ordering is the queue's: one FIFO, so a note always replays after its create and
// the latest queued note wins (`outbox.ts`).

import {
  validateAnnotationNote,
  validateAnnotationQuote,
} from "@/lib/db/annotations";
import {
  enqueueAnnotationCreate,
  enqueueAnnotationDelete,
  enqueueAnnotationNote,
  flushIdle,
  flushOutbox,
  pendingAnnotationEntries,
} from "@/lib/offline/outbox";
import type { Annotation } from "@/lib/types";

export interface AnnotationWriterOptions {
  /** Owner of every write. RLS requires it to be the signed-in user. */
  userId: string;
  /** Defaults to `navigator.onLine !== false`. */
  isOnline?: () => boolean;
}

export interface AnnotationWriter {
  /** Throws `RangeError` synchronously for an invalid annotation; otherwise resolves once queued. */
  create(a: Annotation): Promise<void>;
  /** Throws `RangeError` synchronously for an invalid note; otherwise resolves once queued. */
  setNote(id: string, note: string | null): Promise<void>;
  /** Resolves once the delete is queued. */
  remove(id: string): Promise<void>;
  /**
   * Resolves once no flush is running that could still apply this id's queued
   * writes, or after `SETTLE_TIMEOUT_MS`, whichever comes first. Resolves at once
   * when nothing is queued for `id`.
   */
  settled(id: string): Promise<void>;
  /** True while the outbox still holds this item's create (it has not reached the server). */
  isPending(id: string): Promise<boolean>;
}

/** The longest `settled` waits on a flush that has not finished (a hung request). */
export const SETTLE_TIMEOUT_MS = 8000;

function defaultIsOnline(): boolean {
  try {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  } catch {
    return true;
  }
}

/** Resolves when `idle()` does, or after `ms`, whichever comes first. */
function settleWithin(ms: number, idle: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void idle().then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function createAnnotationWriter(opts: AnnotationWriterOptions): AnnotationWriter {
  const { userId } = opts;
  const isOnline = opts.isOnline ?? defaultIsOnline;

  /** The write is durable once `enqueued` resolves. Only then does a flush start. */
  function afterEnqueue(enqueued: Promise<void>): Promise<void> {
    return enqueued.then(() => {
      if (isOnline()) void flushOutbox();
    });
  }

  /** The key every annotation kind uses in the outbox: `${userId}:${id}`. */
  async function queuedFor(id: string): Promise<{ create: boolean; any: boolean }> {
    try {
      const key = `${userId}:${id}`;
      const entries = await pendingAnnotationEntries(userId);
      const mine = entries.filter((e) => e.key === key);
      return {
        create: mine.some((e) => e.kind === "annotation-create"),
        any: mine.length > 0,
      };
    } catch {
      return { create: true, any: true };
    }
  }

  return {
    create(a) {
      validateAnnotationQuote(a.kind, a.quote);
      validateAnnotationNote(a.note);
      return afterEnqueue(
        enqueueAnnotationCreate(userId, {
          id: a.id,
          bookId: a.book_id,
          kind: a.kind,
          cfi: a.cfi,
          quote: a.quote,
          note: a.note,
          label: a.label,
          percent: a.percent,
        }),
      );
    },

    setNote(id, note) {
      validateAnnotationNote(note);
      return afterEnqueue(enqueueAnnotationNote(userId, id, note));
    },

    remove(id) {
      return afterEnqueue(enqueueAnnotationDelete(userId, id));
    },

    async settled(id) {
      if (!(await queuedFor(id)).any) return;
      await settleWithin(SETTLE_TIMEOUT_MS, flushIdle);
    },

    async isPending(id) {
      return (await queuedFor(id)).create;
    },
  };
}
