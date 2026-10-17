// Write-through writer for personal annotations. LOGIC ONLY — no design/component
// imports.
//
// Each create, note and delete goes straight to Postgres while online, the way
// group-progress.ts writes `read_progress`. Only a transport failure, or being
// offline, hands the write to the outbox, which replays it on the `online` event.
// A rejection (RLS, bad data) is dropped: a retry cannot succeed.
//
// Writes for one item run in order through a per-id promise chain. A note or
// delete issued while its create is still in flight waits for that create to
// settle, then takes the direct path (or merges into the create if it was queued).
// Without this, the note would reach the server before its row exists and be lost.
//
// Lookups of the outbox fail toward the outbox: if the queued-create check cannot
// be read, a note is queued (merges into any queued create) and a delete is queued
// (cancels any queued create). A direct delete on an unknown queued create could
// resurrect the row later. Nothing here throws.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  createAnnotation,
  deleteAnnotation,
  updateAnnotationNote,
} from "@/lib/db/annotations";
import {
  classifyWriteFailure,
  enqueueAnnotationCreate,
  enqueueAnnotationDelete,
  enqueueAnnotationNote,
  pendingAnnotationEntries,
} from "@/lib/offline/outbox";
import type { Annotation } from "@/lib/types";

export interface AnnotationWriterOptions {
  /** Owner of every write. RLS requires it to be the signed-in user. */
  userId: string;
  /** Defaults to the browser client, resolved per write. */
  client?: SupabaseClient;
  /** Defaults to `navigator.onLine !== false`. */
  isOnline?: () => boolean;
}

export interface AnnotationWriter {
  create(a: Annotation): Promise<void>;
  setNote(id: string, note: string | null): Promise<void>;
  remove(id: string): Promise<void>;
  /** Resolves once every write issued so far for `id` has settled. */
  settled(id: string): Promise<void>;
  /** True while the outbox still holds this item's create (it has not reached the server). */
  isPending(id: string): Promise<boolean>;
}

function defaultIsOnline(): boolean {
  try {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  } catch {
    return true;
  }
}

export function createAnnotationWriter(opts: AnnotationWriterOptions): AnnotationWriter {
  const { userId } = opts;
  const isOnline = opts.isOnline ?? defaultIsOnline;
  // Tail promise per annotation id. An entry is removed once its tail settles.
  const chains = new Map<string, Promise<void>>();

  const client = (): SupabaseClient => opts.client ?? createClient();

  /** Run `task` after the id's previous write settles. Never rejects. */
  function serialize(id: string, task: () => Promise<void>): Promise<void> {
    const prev = chains.get(id) ?? Promise.resolve();
    const next: Promise<void> = prev.then(task).catch(() => {});
    chains.set(id, next);
    void next.then(() => {
      if (chains.get(id) === next) chains.delete(id);
    });
    return next;
  }

  /** Whether the outbox holds this item's create. Unknown counts as yes (see header). */
  async function isCreateQueued(id: string): Promise<boolean> {
    try {
      const key = `${userId}:${id}`;
      const entries = await pendingAnnotationEntries(userId);
      return entries.some((e) => e.kind === "annotation-create" && e.key === key);
    } catch {
      return true;
    }
  }

  /**
   * Direct write first; only a transport failure goes to the outbox. A failure that
   * cannot be classified is not known to be a rejection, so it is queued too.
   */
  async function writeThrough(
    direct: (c: SupabaseClient) => Promise<unknown>,
    queue: () => Promise<void>,
  ): Promise<void> {
    try {
      await direct(client());
    } catch (err) {
      if (isTransportFailure(err)) await queue();
    }
  }

  function isTransportFailure(err: unknown): boolean {
    try {
      return classifyWriteFailure(err) === "transport";
    } catch {
      return true;
    }
  }

  return {
    create(a) {
      return serialize(a.id, async () => {
        const input = {
          id: a.id,
          bookId: a.book_id,
          kind: a.kind,
          cfi: a.cfi,
          quote: a.quote,
          note: a.note,
          label: a.label,
          percent: a.percent,
        };
        const queue = () => enqueueAnnotationCreate(userId, input);
        if (!isOnline()) return queue();
        await writeThrough((c) => createAnnotation({ userId, ...input }, c), queue);
      });
    },

    setNote(id, note) {
      return serialize(id, async () => {
        const queue = () => enqueueAnnotationNote(userId, id, note);
        if (!isOnline() || (await isCreateQueued(id))) return queue();
        await writeThrough((c) => updateAnnotationNote(id, note, c), queue);
      });
    },

    remove(id) {
      return serialize(id, async () => {
        const queue = () => enqueueAnnotationDelete(userId, id);
        if (!isOnline() || (await isCreateQueued(id))) return queue();
        await writeThrough((c) => deleteAnnotation(id, c), queue);
      });
    },

    async settled(id) {
      let tail: Promise<void> | undefined;
      while ((tail = chains.get(id)) !== undefined) await tail;
    },

    isPending(id) {
      return isCreateQueued(id);
    },
  };
}
