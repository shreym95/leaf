// Bookmark manager (REVISED_PLAN §6 Phase 2). LOGIC ONLY — no design/component
// imports (ESLint seam rule).
//
// Mirrors `./highlights.ts` in shape: load the book's bookmarks, keep an
// in-memory list, notify subscribers (the notes panel renders off this), and
// add / remove with the BROWSER Supabase client + RLS (`user_id = auth.uid()`).
//
// Unlike highlights there is nothing to paint on the page — a bookmark is a
// list entry that points at a CFI — so this manager takes no controller. The
// visible bookmark treatment (a ribbon, a margin mark, whatever the design
// decision lands on) is a UI concern layered on top later; the schema, this
// manager and the db layer do not change when it does.
//
// Every write is best-effort: a failed write must never throw into the reader
// (identical reasoning to `position.ts` / `highlights.ts`).

import { createClient } from "@/lib/supabase/client";
import {
  createBookmark,
  deleteBookmark,
  listBookmarks,
} from "@/lib/db/bookmarks";
import type { Bookmark } from "@/lib/types";

export interface BookmarkRecord {
  id: string;
  bookId: string;
  cfi: string;
  label: string | null;
  percent: number | null;
  createdAt: string;
}

export interface CreateBookmarkArgs {
  cfi: string;
  /** Chapter title at save time — denormalised (0005). */
  label?: string | null;
  /** 0–1 progress at save time — denormalised (0005). */
  percent?: number | null;
}

export interface BookmarkManager {
  /** Load every bookmark for the book from `bookmarks`. */
  restore(): Promise<BookmarkRecord[]>;
  create(input: CreateBookmarkArgs): Promise<BookmarkRecord>;
  remove(id: string): Promise<void>;
  list(): BookmarkRecord[];
  /** Subscribe to the in-memory list changing (for the notes panel). */
  subscribe(cb: (list: BookmarkRecord[]) => void): () => void;
  stop(): void;
}

function toRecord(row: Bookmark): BookmarkRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    cfi: row.cfi,
    label: row.label,
    percent: row.percent,
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

export function manageBookmarks(bookId: string): BookmarkManager {
  let records: BookmarkRecord[] = [];
  let stopped = false;
  const subscribers = new Set<(list: BookmarkRecord[]) => void>();

  function snapshot(): BookmarkRecord[] {
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

  async function auth(): Promise<{
    supabase: ReturnType<typeof createClient>;
    userId: string;
  } | null> {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      return { supabase, userId: user.id };
    } catch {
      return null;
    }
  }

  return {
    async restore(): Promise<BookmarkRecord[]> {
      if (stopped) return snapshot();
      const a = await auth();
      if (a) {
        try {
          const rows = await listBookmarks(a.userId, bookId, a.supabase);
          records = rows.map(toRecord);
        } catch {
          // best-effort: keep whatever we already have
        }
      }
      notify();
      return snapshot();
    },

    async create(input: CreateBookmarkArgs): Promise<BookmarkRecord> {
      let rec: BookmarkRecord = {
        id: localId(),
        bookId,
        cfi: input.cfi,
        label: input.label ?? null,
        percent: input.percent ?? null,
        createdAt: new Date().toISOString(),
      };

      const a = await auth();
      if (a) {
        try {
          const row = await createBookmark(
            a.userId,
            {
              bookId,
              cfi: input.cfi,
              label: input.label ?? null,
              percent: input.percent ?? null,
            },
            a.supabase,
          );
          rec = toRecord(row);
        } catch {
          // best-effort: keep the optimistic record (local id) so the bookmark
          // is still listed this session
        }
      }

      records = [...records, rec];
      notify();
      return { ...rec };
    },

    async remove(id: string): Promise<void> {
      const target = records.find((r) => r.id === id);
      if (!target) return;

      records = records.filter((r) => r.id !== id);
      notify();

      const a = await auth();
      if (a) {
        try {
          await deleteBookmark(a.userId, id, a.supabase);
        } catch {
          // best-effort
        }
      }
    },

    list(): BookmarkRecord[] {
      return snapshot();
    },

    subscribe(cb: (list: BookmarkRecord[]) => void): () => void {
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
