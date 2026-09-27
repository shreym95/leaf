// Reading-position tracking + restore (SPEC §3.7, §8). LOGIC ONLY — no
// design/component imports.
//
// The CFI round-trip is the core promise: what you were reading is exactly
// where you reopen (same device or another). This module:
//   - subscribes to the engine's `relocated` stream, debounces, and writes the
//     CFI + percent to `reading_state`;
//   - `restore()` reads the row back and navigates the engine to that CFI.
//
// Write path: the BROWSER Supabase client + RLS, not a Route Handler. RLS on
// `reading_state` is `user_id = auth.uid()`, which resolves from the session
// cookie, so a direct client write is already scoped to the user — no extra
// endpoint to build or secure. `user_id` for the row comes from
// `supabase.auth.getUser()`.

import { createClient } from "@/lib/supabase/client";
import { getReadingState, upsertReadingState } from "@/lib/db/reading-state";
import { IS_DEMO } from "@/lib/demo/flag";
import { demoPositionKey, readDemoJSON, writeDemoJSON } from "@/lib/demo/local";
import {
  classifyWriteFailure,
  enqueueReadingState,
  getCachedUserId,
  isFurtherAlong,
} from "@/lib/offline/outbox";
import {
  readCachedPosition,
  writeCachedPosition,
  type CachedPosition,
} from "./position-cache";
import type { ReaderController, ReaderLocation } from "./engine";

export interface PositionTracker {
  restore(): Promise<boolean>;
  stop(): void;
}

const DEFAULT_DEBOUNCE_MS = 1500;

/**
 * Furthest-of-local-and-server-wins for restore, reusing `isFurtherAlong`
 * (`@/lib/offline/outbox`, §8(b)) rather than a second copy of the same rule.
 * NOT "most recent" — a stale server row must never drag a reader backwards
 * on a device that has since read further, and a stale local entry must
 * never do the same to a position that has since synced further on another
 * device. Exported so the merge itself is directly testable without driving
 * a whole `restore()` call for every case.
 */
export function pickFurthestPosition(
  local: CachedPosition | undefined,
  server: CachedPosition | undefined,
): CachedPosition | undefined {
  if (!local) return server;
  if (!server) return local;
  const localIsFurthest = isFurtherAlong(
    { percent: server.percent, updatedAt: server.updatedAt },
    { percent: local.percent, updatedAt: local.updatedAt },
  );
  return localIsFurthest ? local : server;
}

export function trackPosition(
  controller: ReaderController,
  bookId: string,
  opts?: { debounceMs?: number },
): PositionTracker {
  const debounceMs = opts?.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { cfi: string; percent: number } | undefined;
  let stopped = false;

  async function flush(): Promise<void> {
    if (!pending) return;
    const toWrite = pending;
    pending = undefined;
    // Demo mode: keep the reading position in this browser's localStorage.
    if (IS_DEMO) {
      writeDemoJSON(demoPositionKey(bookId), toWrite);
      return;
    }
    // Local cache, written alongside the server write below (including when
    // that write fails and is queued to the outbox instead) — this is what
    // lets `restore()` work at all when the server is unreachable. See
    // `position-cache.ts`.
    writeCachedPosition(bookId, { ...toWrite, updatedAt: new Date().toISOString() });
    let supabase: ReturnType<typeof createClient> | undefined;
    try {
      supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return; // signed out — nothing to scope the write to
      await upsertReadingState(user.id, bookId, toWrite, supabase);
    } catch (err) {
      // Position sync is best-effort: a failed write must never interrupt
      // reading. A connectivity failure is queued so the write survives a
      // reload (outbox.ts, §8a); a non-network rejection (RLS, bad data) is
      // dropped — retrying it forever would never succeed.
      if (!supabase || classifyWriteFailure(err) !== "transport") return;
      const userId = await getCachedUserId(supabase);
      if (!userId) return;
      await enqueueReadingState(userId, bookId, toWrite);
    }
  }

  // D8: `stop()` (React unmount) is not enough — backgrounding or killing a
  // mobile tab never unmounts, so up to `debounceMs` of page turns were lost.
  // `visibilitychange`→hidden and `pagehide` are the only events reliably
  // delivered on mobile Safari/Chrome (`beforeunload`/`unload` are not).
  //
  // A normal async request can be cancelled the instant the page is hidden,
  // and neither fallback actually works here: `sendBeacon` can only POST a
  // body with no custom headers, so it cannot carry the `apikey` /
  // `Authorization` headers a Supabase REST write needs; a `keepalive` fetch
  // could in principle, but only by hand-building the PostgREST request
  // outside the shared browser client (`@/lib/supabase/client`, which this
  // agent does not own) and duplicating its auth/upsert semantics. So: skip
  // the network entirely on hide and enqueue straight to the outbox — a
  // local IndexedDB append that has a real chance of finishing inside the
  // brief window a hidden/pagehide handler gets, and is durable if the tab
  // is killed a moment later.
  function flushToOutboxOnHide(): void {
    if (!pending) return;
    const toWrite = pending;
    pending = undefined;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (IS_DEMO) {
      writeDemoJSON(demoPositionKey(bookId), toWrite);
      return;
    }
    writeCachedPosition(bookId, { ...toWrite, updatedAt: new Date().toISOString() });
    try {
      const supabase = createClient();
      void (async () => {
        const userId = await getCachedUserId(supabase);
        if (!userId) return; // no cached session — nothing to queue against
        await enqueueReadingState(userId, bookId, toWrite);
      })();
    } catch {
      // Supabase not configured — nothing to queue against.
    }
  }

  function onVisibilityChange(): void {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      flushToOutboxOnHide();
    }
  }
  function onPageHide(): void {
    flushToOutboxOnHide();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
  }

  const unsubscribe = controller.onRelocated((loc: ReaderLocation) => {
    if (stopped || !loc.cfi) return;
    pending = { cfi: loc.cfi, percent: loc.percent };
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, debounceMs);
  });

  return {
    async restore(): Promise<boolean> {
      if (IS_DEMO) {
        const saved = readDemoJSON<{ cfi: string; percent: number }>(
          demoPositionKey(bookId),
        );
        if (!saved?.cfi) return false;
        try {
          await controller.goTo(saved.cfi);
          return true;
        } catch {
          return false;
        }
      }
      // Local read first — cheap and always available, offline or not.
      const local = readCachedPosition(bookId);

      // `getSession()`, not `getUser()`: the latter revalidates against the
      // Auth server, a network round trip that, by construction, cannot
      // succeed exactly when this fallback matters most (offline). Same
      // reasoning as `src/lib/offline/owner.ts`'s `getLocalSessionUserId`.
      let server: CachedPosition | undefined;
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (userId) {
          const row = await getReadingState(userId, bookId, supabase);
          if (row?.cfi) {
            server = { cfi: row.cfi, percent: row.percent, updatedAt: row.updated_at };
          }
        }
      } catch {
        // Offline, or any other failure reaching the server — fall back to
        // whatever this device has locally via `pickFurthestPosition` below.
      }

      const winner = pickFurthestPosition(local, server);
      if (!winner) return false;
      try {
        await controller.goTo(winner.cfi);
        return true;
      } catch {
        return false;
      }
    },

    stop(): void {
      stopped = true;
      unsubscribe();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", onPageHide);
      }
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      // Flush a pending debounced write so the last page read is not lost.
      void flush();
    },
  };
}
