// Highlight + note manager (SPEC §3.1, §8, §9 M4). LOGIC ONLY — no design /
// component imports (ESLint seam rule).
//
// The core promise, same shape as position tracking: a highlight is anchored by
// epub.js CFI range and synced, so it survives reopen and follows you across
// devices. This module:
//   - `restore()` loads every highlight for the book from `highlights` and
//     paints each one back onto the live rendition at its CFI range;
//   - `create()` persists a new highlight (browser Supabase client + RLS) and
//     paints it immediately;
//   - `setNote()` / `remove()` update the row and the in-memory list;
//   - keeps an in-memory list and notifies subscribers on every change (the
//     notes panel renders off this).
//
// Write path: the BROWSER Supabase client + RLS (`user_id = auth.uid()`), not a
// Route Handler — identical reasoning to `position.ts`. `user_id` comes from
// `supabase.auth.getUser()`. Every write is best-effort: a failed write must
// never throw into the reader.
//
// COLOUR STAYS OUT OF THIS LAYER. The manager only ever handles a colour NAME
// string (`"copper" | "sage" | "sky" | "rose"`, stored in `highlights.color`).
// The concrete CSS for the epub.js annotation comes from `opts.stylesFor`, which
// the design layer (Agent B's UI) supplies — the manager never knows a hex.

import { createClient } from "@/lib/supabase/client";
import {
  createHighlight,
  deleteHighlight,
  listHighlights,
  updateHighlightNote,
} from "@/lib/db/highlights";
import type { Highlight } from "@/lib/types";
import type { ReaderController } from "./engine";
import {
  cancelQueuedHighlightCreate,
  classifyWriteFailure,
  enqueueHighlightCreate,
  enqueueHighlightDelete,
  enqueueHighlightNote,
  resolveUserId,
} from "@/lib/offline/outbox";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Stable highlight colour names. Design layer maps name -> token -> CSS. */
export const HIGHLIGHT_COLORS = ["copper", "sage", "sky", "rose"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** Matches the `highlights.color` column default (`0001_init.sql`). */
export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "copper";

export interface HighlightRecord {
  id: string;
  bookId: string;
  cfiRange: string;
  text: string;
  color: string;
  note: string | null;
  createdAt: string;
}

export interface HighlightManager {
  /** Load from the db and paint them all onto the rendition. */
  restore(): Promise<HighlightRecord[]>;
  create(input: {
    cfiRange: string;
    text: string;
    color?: string;
  }): Promise<HighlightRecord>;
  setNote(id: string, note: string | null): Promise<void>;
  remove(id: string): Promise<void>;
  list(): HighlightRecord[];
  /** Subscribe to the in-memory list changing (for the notes panel). */
  subscribe(cb: (list: HighlightRecord[]) => void): () => void;
  stop(): void;
}

function toRecord(row: Highlight): HighlightRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    cfiRange: row.cfi_range,
    text: row.text,
    color: row.color,
    note: row.note,
    createdAt: row.created_at,
  };
}

function localId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return `local-${c.randomUUID()}`;
  } catch {
    // fall through
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function manageHighlights(
  controller: ReaderController,
  bookId: string,
  opts: {
    stylesFor: (color: string) => Record<string, string>;
    onHighlightClick?: (h: HighlightRecord) => void;
  },
): HighlightManager {
  const { stylesFor, onHighlightClick } = opts;

  let records: HighlightRecord[] = [];
  let stopped = false;
  const subscribers = new Set<(list: HighlightRecord[]) => void>();

  function snapshot(): HighlightRecord[] {
    return records.map((r) => ({ ...r }));
  }

  function notify(): void {
    const list = snapshot();
    for (const cb of subscribers) {
      try {
        cb(list);
      } catch {
        // a bad subscriber must not break the others
      }
    }
  }

  // The one place a colour name becomes concrete CSS — via the caller's
  // `stylesFor`, never a literal in this file.
  function paint(rec: HighlightRecord): void {
    controller.addHighlight(rec.cfiRange, {
      id: rec.id,
      styles: stylesFor(rec.color),
      onClick: onHighlightClick ? () => onHighlightClick(rec) : undefined,
    });
  }

  async function auth(): Promise<{
    supabase: SupabaseClient;
    userId: string;
  } | null> {
    try {
      const supabase = createClient();
      // `resolveUserId` falls back to the cached session (no network) if
      // `getUser()` fails for being offline, so a write made offline can
      // still be identified and queued rather than dropped outright.
      const userId = await resolveUserId(supabase);
      if (!userId) return null;
      return { supabase, userId };
    } catch {
      return null;
    }
  }

  return {
    async restore(): Promise<HighlightRecord[]> {
      if (stopped) return snapshot();
      const a = await auth();
      if (a) {
        try {
          const rows = await listHighlights(a.userId, bookId, a.supabase);
          records = rows.map(toRecord);
        } catch {
          // best-effort: keep whatever we already have
        }
      }
      for (const rec of records) paint(rec); // paint is defensive in the engine
      notify();
      return snapshot();
    },

    async create(input: {
      cfiRange: string;
      text: string;
      color?: string;
    }): Promise<HighlightRecord> {
      const color = input.color ?? DEFAULT_HIGHLIGHT_COLOR;
      let rec: HighlightRecord = {
        id: localId(),
        bookId,
        cfiRange: input.cfiRange,
        text: input.text,
        color,
        note: null,
        createdAt: new Date().toISOString(),
      };

      const a = await auth();
      if (a) {
        try {
          const row = await createHighlight(
            a.userId,
            { bookId, cfiRange: input.cfiRange, text: input.text, color },
            a.supabase,
          );
          rec = toRecord(row);
        } catch (err) {
          // best-effort: keep the optimistic record (local id) so the
          // highlight is still painted and listed this session. A
          // connectivity failure is queued so it also survives a reload; a
          // rejection (RLS, bad data) is dropped.
          if (classifyWriteFailure(err) === "transport") {
            await enqueueHighlightCreate(a.userId, {
              localId: rec.id,
              bookId,
              cfiRange: input.cfiRange,
              text: input.text,
              color,
            });
          }
        }
      }

      records = [...records, rec];
      paint(rec);
      notify();
      return { ...rec };
    },

    async setNote(id: string, note: string | null): Promise<void> {
      const target = records.find((r) => r.id === id);
      if (!target) return;

      records = records.map((r) => (r.id === id ? { ...r, note } : r));
      notify();

      const a = await auth();
      if (a) {
        try {
          await updateHighlightNote(a.userId, id, note, a.supabase);
        } catch (err) {
          // best-effort: the in-memory note stands for this session. A
          // connectivity failure is queued so it survives a reload; a
          // rejection is dropped.
          if (classifyWriteFailure(err) === "transport") {
            await enqueueHighlightNote(a.userId, id, note);
          }
        }
      }
    },

    async remove(id: string): Promise<void> {
      const target = records.find((r) => r.id === id);
      if (!target) return;

      records = records.filter((r) => r.id !== id);
      controller.removeHighlight(target.cfiRange);
      notify();

      if (id.startsWith("local-")) {
        // This highlight never made it past an earlier offline create —
        // there is nothing server-side to delete. Cancel the still-queued
        // create instead, so it never replays into a highlight the reader
        // thought they'd already removed.
        const a = await auth();
        if (a) await cancelQueuedHighlightCreate(a.userId, id);
        return;
      }

      const a = await auth();
      if (a) {
        try {
          await deleteHighlight(a.userId, id, a.supabase);
        } catch (err) {
          // best-effort: a connectivity failure is queued so the delete
          // survives a reload; a rejection is dropped, not retried forever.
          if (classifyWriteFailure(err) === "transport") {
            await enqueueHighlightDelete(a.userId, id);
          }
        }
      }
    },

    list(): HighlightRecord[] {
      return snapshot();
    },

    subscribe(cb: (list: HighlightRecord[]) => void): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    stop(): void {
      stopped = true;
      subscribers.clear();
    },
  };
}
