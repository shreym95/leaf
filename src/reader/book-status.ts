// Writes "finished" / "unread" for a book from the reader. LOGIC ONLY — no
// design/component imports. Never throws: recording a finish is a side effect
// of reading and must not be able to interrupt it.
//
// Identity is the CACHED session user (`getCachedUserId`, no network), not
// `auth.getUser()`. Offline, auth-js returns `{ user: null, error }` rather
// than throwing, so a `getUser()`-then-`if (!user) return` guard cannot tell
// "signed out" from "no connection" and silently drops exactly the write the
// outbox exists to keep. The cached id only scopes the queue entry; RLS
// (`books` is owner-only) still guards the write itself, server-side.
//
// Failure handling follows the other reader writes: a transport failure
// (offline, dead link) is queued to the outbox and replays later; anything
// else (RLS denial, bad data) would never succeed on retry and is dropped.

import { createClient } from "@/lib/supabase/client";
import { setBookFinished } from "@/lib/db/book-status";
import { IS_DEMO } from "@/lib/demo/flag";
import {
  classifyWriteFailure,
  enqueueBookStatus,
  getCachedUserId,
} from "@/lib/offline/outbox";

async function record(bookId: string, finishedAt: string | null): Promise<void> {
  // Demo mode has no backend to write to.
  if (IS_DEMO) return;
  try {
    const supabase = createClient();
    const userId = await getCachedUserId(supabase);
    if (!userId) return; // signed out — nothing to scope the write to
    try {
      await setBookFinished(userId, bookId, finishedAt, supabase);
    } catch (err) {
      if (classifyWriteFailure(err) !== "transport") return;
      await enqueueBookStatus(userId, bookId, finishedAt);
    }
  } catch {
    // Supabase not configured, or the outbox itself failed — drop, as today.
  }
}

/** The reader reached the end of the book. Stamps "now" as the finish date. */
export function recordFinished(bookId: string): Promise<void> {
  return record(bookId, new Date().toISOString());
}

/** Put a book back to unread (clears the finish date). */
export function recordUnread(bookId: string): Promise<void> {
  return record(bookId, null);
}
