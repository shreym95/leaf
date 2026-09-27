// Sign-out / account-deletion purge orchestrator for offline reading data.
//
// Offline reading (book-store.ts, outbox.ts, service-worker.ts) put three new
// things on disk that never existed before: cached book bytes + metadata,
// queued writes keyed by user id, and cached *authenticated* reader documents
// in Cache Storage. None of that is purged today — this module is the single
// place that purges all three, so sign-out and account deletion each have one
// call to make instead of three.
//
// LOGIC ONLY — no design/component imports (ESLint seam rule, matches
// book-store.ts / outbox.ts).
//
// ---------------------------------------------------------------------------
// Why this can never throw or hang
// ---------------------------------------------------------------------------
// This is called from a sign-out click handler and an account-deletion
// handler, both of which MUST complete even if a purge mechanism is broken,
// missing, or blocked (private browsing, disabled storage, no service
// worker). `purgeCachedBooks()` and `purgeOutbox()` already never throw (see
// their own headers). The service worker leg is different in kind: it is a
// postMessage round trip, which has no built-in timeout and can, in
// principle, never receive a reply (no controller yet, worker wedged, or the
// browser simply not shipping a service worker). So:
//
//   - each of the three legs is wrapped so a rejection can't escape it;
//   - the service worker leg additionally races its own reply against a
//     short timeout, since "wait for the postMessage reply" is the one leg
//     with no other bound;
//   - the whole orchestrator races the combined result against a second,
//     slightly longer timeout, as an independent backstop in case a future
//     change to any of these legs (or a genuinely stuck IndexedDB
//     transaction behind another tab) introduces a hang this file didn't
//     anticipate.
//
// `purgeAllOfflineData()` therefore always settles (never rejects) within
// `OVERALL_TIMEOUT_MS`, and normally in low single-digit milliseconds.

import { purgeCachedBooks } from "./book-store";
import { purgeOutbox } from "./outbox";

export const SW_PURGE_MESSAGE_TYPE = "leaf-offline/purge";
export const SW_PURGED_MESSAGE_TYPE = "leaf-offline/purged";

/** How long to wait for the service worker's purge confirmation before
 * giving up on *that leg specifically*. The message is posted either way —
 * this only bounds how long we wait to hear back. A worker that purges after
 * this window still purges; we just stop waiting to say so. */
export const SW_ACK_TIMEOUT_MS = 800;

/** Upper bound on the whole orchestrator, independent of the two legs above.
 * `purgeCachedBooks`/`purgeOutbox` are a handful of IndexedDB `clear()` calls
 * that normally resolve in well under a millisecond, but an IndexedDB
 * transaction can in principle stall behind another open transaction/tab.
 * This is a second, independent guarantee that this function always settles,
 * not a bound we expect callers to ever actually hit. */
export const OVERALL_TIMEOUT_MS = 1500;

/** Resolves `promise`'s outcome if it settles first, otherwise resolves
 * (never rejects) once `ms` elapses. Used only to bound how long we WAIT —
 * the underlying work is not cancelled, it just stops being awaited. */
function resolveWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(finish, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        finish();
      },
      () => {
        clearTimeout(timer);
        finish();
      }
    );
  });
}

/**
 * Cache name of the service worker's READER_CACHE — the one worker-owned
 * cache that can hold anything user-specific (authenticated `/reader/<id>`
 * documents, each embedding a short-lived signed Supabase Storage URL). Kept
 * in step with `READER_CACHE` in `service-worker.ts` by hand rather than
 * imported: that module registers worker event listeners at import time, so
 * pulling a constant out of it would drag worker code into the page bundle.
 *
 * This is deliberately the ONLY worker-owned cache this file deletes.
 * `leaf-offline-offline` (the precached, auth-free `/offline` document —
 * byte-identical for every user and already publicly fetchable),
 * `leaf-offline-static` (public `/_next/static/*` build assets) and
 * `leaf-offline-meta` (a build id string) hold nothing user-specific, and
 * `precacheOfflineShell()` in `service-worker.ts` only repopulates
 * `leaf-offline-offline` on `install` — nothing does it at runtime — so
 * deleting it here would leave a signed-out, offline visitor with no way
 * back into the app until the next deploy.
 */
const READER_CACHE_NAME = "leaf-offline-reader";

/**
 * Delete the worker's reader-document cache directly from the page. Cache
 * Storage is same-origin state the window can reach — it is not private to
 * the worker.
 *
 * This is the leg that actually guarantees the purge. Messaging the worker is
 * not sufficient on its own: **Cache Storage outlives the session that filled
 * it.** A worker installed on an earlier visit can hold cached authenticated
 * reader documents while *this* page load has no controller yet (the first
 * load after registration, or a tab that loaded before the worker claimed
 * it). Skipping the purge in that case — as "no controller, nothing to
 * purge" would — leaves one user's reader documents on the device for the
 * next person to sign in.
 */
async function purgeCacheStorage(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    await caches.delete(READER_CACHE_NAME);
  } catch {
    // Cache Storage is unavailable (SSR, or a browser blocking site data).
  }
}

/**
 * Ask the service worker to drop its caches, and wait (briefly) for it to
 * confirm. Never throws.
 *
 * This runs *alongside* `purgeCacheStorage`, not instead of it. A live worker
 * is told so it drops its own handles and cannot repopulate from work already
 * in flight; the direct deletion above is what covers the uncontrolled case.
 *
 * No-ops when: there is no `navigator` (SSR), the browser has no
 * `serviceWorker` support, or no worker currently controls this page — in
 * that last case there is simply nobody to message.
 */
function purgeServiceWorkerCaches(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return Promise.resolve();
    }

    const controller = navigator.serviceWorker.controller;
    if (!controller) {
      return Promise.resolve();
    }

    const acked = new Promise<void>((resolve) => {
      function onMessage(event: MessageEvent) {
        const data = event.data as { type?: string } | null;
        if (data?.type === SW_PURGED_MESSAGE_TYPE) {
          navigator.serviceWorker.removeEventListener("message", onMessage);
          resolve();
        }
      }
      try {
        navigator.serviceWorker.addEventListener("message", onMessage);
        controller.postMessage({ type: SW_PURGE_MESSAGE_TYPE });
      } catch {
        navigator.serviceWorker.removeEventListener("message", onMessage);
        resolve();
      }
    });

    return resolveWithin(acked, SW_ACK_TIMEOUT_MS);
  } catch {
    // Accessing navigator.serviceWorker itself should never throw in a real
    // browser, but this leg is not allowed to be the thing that breaks
    // sign-out, so guard it anyway.
    return Promise.resolve();
  }
}

/**
 * Reading-position and locations tables kept in `localStorage` by
 * `src/reader/position-cache.ts` and `src/reader/locations-cache.ts`. Both
 * are keyed `leaf:<name>:v<n>:<bookId>` and hold per-user reading data — how
 * far through a book someone got — so they must not outlive the session that
 * produced it any more than the book bytes do.
 *
 * Swept by prefix rather than by book id: the ids of the books this device
 * cached are exactly what is being deleted alongside, so there is nothing
 * left to enumerate them with.
 */
const LOCAL_READING_PREFIXES = ["leaf:position:v", "leaf:locations:v"];

function purgeLocalReadingState(): void {
  try {
    if (typeof localStorage === "undefined") return;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && LOCAL_READING_PREFIXES.some((p) => key.startsWith(p))) {
        doomed.push(key);
      }
    }
    // Collected first, then removed: removing during the scan shifts the
    // indices underneath it and silently skips entries.
    for (const key of doomed) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Keep going — one failure must not strand the rest.
      }
    }
  } catch {
    // Storage blocked or unavailable; nothing to purge.
  }
}

/**
 * Purge every trace of the signed-in user's offline data from this device:
 * cached book bytes/metadata (`leaf-books`), queued outbox writes
 * (`leaf-outbox`), and the service worker's cached reader documents — the
 * last both by messaging a live worker and by deleting the caches directly,
 * since a worker need not be controlling this page for its caches to exist.
 *
 * Runs every leg concurrently. Never throws, and always settles within
 * `OVERALL_TIMEOUT_MS` even if a storage backend is blocked, missing, or
 * unresponsive — safe to `await` from a flow (sign-out, account deletion)
 * that must never be blocked or failed by a purge problem. Each leg is
 * independent: one being unavailable does not stop the others from running.
 */
export async function purgeAllOfflineData(): Promise<void> {
  const legs = Promise.all([
    purgeCachedBooks().catch(() => undefined),
    purgeOutbox().catch(() => undefined),
    purgeServiceWorkerCaches().catch(() => undefined),
    purgeCacheStorage().catch(() => undefined),
  ]).then(() => undefined);

  // Synchronous and local — no reason to race it against the timeout below.
  purgeLocalReadingState();

  await resolveWithin(legs, OVERALL_TIMEOUT_MS);
}
