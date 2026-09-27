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

/** What `onSyncOffer` hands the reader chrome — enough to render a chip and
 *  act on it, nothing this module isn't itself style-agnostic about. */
export interface SyncOffer {
  cfi: string;
}

export interface PositionTracker {
  /**
   * Navigates the engine to the best position we can find, in two phases:
   *
   *   1. FOREGROUND (awaited by this promise): if a local cache entry
   *      exists, jump to it immediately — no network involved, so this is
   *      never gated on the server. Only when there is NO local entry does
   *      this phase talk to the server at all, and even then it's bounded
   *      (`SERVER_LEG_TIMEOUT_MS`) rather than left to hang.
   *   2. BACKGROUND (NOT awaited by this promise, fire-and-forget): if a
   *      local jump just happened, the server is asked in the background
   *      whether it has something FURTHER along (never merely different —
   *      see `pickFurthestPosition`). It is NEVER applied automatically —
   *      `docs/REVISED_PLAN.md` §8(c) calls for a passive prompt on
   *      cross-device sync, not silent convergence, and a reader is
   *      mid-page by the time this resolves, so an unrequested second
   *      `goTo` would yank the page out from under them with no jump they
   *      asked for and (unlike a chapter/bookmark jump) no `ReturnChip` set
   *      up to undo it. Instead, when the server IS strictly further along,
   *      `onSyncOffer` fires once so the chrome can offer it — see that
   *      method. Skipped entirely if the device is known offline, if the
   *      tracker has since been `stop()`-ped, or if the reader's own
   *      reading has already reached or passed the offered position.
   *
   * Resolves `true` if phase 1 produced a navigation (local or server),
   * `false` if it found nothing to navigate to. The phase-2 background
   * reconcile's own outcome is never reflected in this promise — callers
   * (`ReaderShell`) that `await restore()` must not expect it to still be
   * running, or to be done, by the time this resolves. `stop()` remains the
   * only way to guarantee the background reconcile can no longer fire
   * `onSyncOffer`.
   */
  restore(): Promise<boolean>;
  /** Fires at most once per `restore()` call, only for the case described
   *  above. Returns an unsubscribe fn. Never fires after `stop()`. */
  onSyncOffer(cb: (offer: SyncOffer) => void): () => void;
  stop(): void;
}

const DEFAULT_DEBOUNCE_MS = 1500;

/**
 * Upper bound on the server leg of `restore()` — both the "no local entry"
 * foreground fetch and the background reconcile fetch. `navigator.onLine`
 * only ever tells the truth when it's `false` (see `isPlausiblyOnline`); a
 * captive portal or a dead upstream link can report `true` while
 * `getSession()`'s token refresh or `getReadingState()`'s request never
 * resolves at all, and neither call has a bound of its own. Chosen generous
 * enough to complete a real (if slow) round trip rather than false-negative
 * a working-but-slow connection, and short enough that "no local position,
 * device is actually offline" doesn't leave the reader waiting long before
 * falling back to page 0.
 */
export const SERVER_LEG_TIMEOUT_MS = 4000;

/**
 * `navigator.onLine` is asymmetric (see `OfflineIndicator`'s own comment,
 * `src/components/reader-ui/OfflineIndicator.tsx`): a browser only ever
 * reports `false` when it's SURE there's no link at all, so that side is
 * trustworthy — a `true` can still be a captive portal or a dead upstream
 * link. Used here only to decide whether it's worth ATTEMPTING the
 * background reconcile at all; `SERVER_LEG_TIMEOUT_MS` is what actually
 * bounds a false "online" that goes nowhere.
 */
function isPlausiblyOnline(): boolean {
  try {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  } catch {
    return true; // unknown — attempt the reconcile rather than skip it
  }
}

/**
 * Resolves to `promise`'s value if it settles first, otherwise to `fallback`
 * once `ms` elapses — never rejects. Shaped after `resolveWithin` in
 * `src/lib/offline/purge.ts` (not imported: that one discards the value and
 * this one needs it), for the same reason: this bounds how long we WAIT, it
 * does not cancel the underlying work, which may still complete later and is
 * simply no longer being listened for.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * The server's reading-state row for `bookId`, or `undefined` on any kind of
 * miss (signed out, no row, or a failure reaching the server — offline
 * chief among them). `getSession()`, not `getUser()`: the latter revalidates
 * against the Auth server, a network round trip that, by construction,
 * cannot succeed exactly when this fallback matters most (offline). Same
 * reasoning as `src/lib/offline/owner.ts`'s `getLocalSessionUserId`.
 *
 * Deliberately unbounded in here — `restore()` wraps every call to this in
 * `withTimeout` itself, so the bound lives in exactly one place regardless
 * of which of `restore()`'s two call sites (the "no local entry" foreground
 * fetch, or the background reconcile) is asking.
 */
async function fetchServerPosition(
  bookId: string,
): Promise<CachedPosition | undefined> {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return undefined;
    const row = await getReadingState(userId, bookId, supabase);
    if (!row?.cfi) return undefined;
    return { cfi: row.cfi, percent: row.percent, updatedAt: row.updated_at };
  } catch {
    return undefined;
  }
}

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
  // Updated by the SAME relocated subscription below, on every event
  // (regardless of the write debounce) — the background reconcile's only
  // way to know "has the reader already read past the offer by the time the
  // server answered", without duplicating page-turn bookkeeping that
  // `ReaderShell` already owns for its own chrome concerns.
  let lastKnownPercent: number | undefined;
  const syncOfferListeners = new Set<(offer: SyncOffer) => void>();

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
    lastKnownPercent = loc.percent;
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
      // Local read first — cheap and always available, offline or not. See
      // `position-cache.ts` for why this is synchronous `localStorage`
      // rather than IndexedDB: `restore()` needs it ready on THIS call, not
      // a tick later.
      const local = readCachedPosition(bookId);

      if (local) {
        // FOREGROUND: jump now. Never gated on the network — this is the
        // entire point of the local cache existing. `lastKnownPercent`
        // seeded here (rather than left to wait for the `relocated` event
        // this `goTo` is about to cause) closes a race: the background
        // reconcile below could otherwise run its "has the reader already
        // caught up" check before that event lands.
        lastKnownPercent = local.percent;
        let applied = true;
        try {
          await controller.goTo(local.cfi);
        } catch {
          applied = false;
        }

        // BACKGROUND: reconcile with the server, but never navigate for it —
        // see the `onSyncOffer` doc comment on why a second, unrequested
        // `goTo` here would be worse than the bug this replaced. Skipped
        // outright if the device is known offline; bounded either way so a
        // captive portal reporting `onLine: true` can't leave this running
        // forever (harmlessly, since nothing awaits it — but a `stopped`
        // tracker should stop working, not just stop mattering).
        if (isPlausiblyOnline() && !stopped) {
          void (async () => {
            const server = await withTimeout(
              fetchServerPosition(bookId),
              SERVER_LEG_TIMEOUT_MS,
              undefined,
            );
            // Re-checked AFTER the await: a stop() during the fetch (the
            // reader navigated away, or the view was torn down) must mean
            // this can no longer surface anything, no matter what the
            // server said.
            if (stopped || !server) return;

            const winner = pickFurthestPosition(local, server);
            if (winner !== server) return; // not strictly further — silent, per case 2

            // The reader may have kept reading (their own page turns) while
            // this was in flight. If they've already reached or passed the
            // offered position under their own steam, offering it now would
            // be presenting stale, redundant, possibly-backwards-looking
            // "news" — suppress rather than interrupt.
            if (lastKnownPercent !== undefined && lastKnownPercent >= server.percent) {
              return;
            }

            syncOfferListeners.forEach((cb) => cb({ cfi: server.cfi }));
          })();
        }

        return applied;
      }

      // No local position: same shape as before this fix, but the server
      // leg is now bounded — a captive portal reporting `onLine: true` while
      // nothing ever resolves must not hang this restore indefinitely.
      // Applied directly and silently: there is no existing position here to
      // disturb, so this IS the restore, not a competing one (case 1).
      const server = await withTimeout(
        fetchServerPosition(bookId),
        SERVER_LEG_TIMEOUT_MS,
        undefined,
      );
      if (!server) return false;
      try {
        await controller.goTo(server.cfi);
        return true;
      } catch {
        return false;
      }
    },

    onSyncOffer(cb: (offer: SyncOffer) => void): () => void {
      syncOfferListeners.add(cb);
      return () => syncOfferListeners.delete(cb);
    },

    stop(): void {
      stopped = true;
      // `stopped` is what actually gates a late background reconcile from
      // emitting — this just releases the listener references promptly
      // rather than waiting on that fetch to come back (or time out).
      syncOfferListeners.clear();
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
