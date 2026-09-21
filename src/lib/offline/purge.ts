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
 * Ask the service worker to drop its caches, and wait (briefly) for it to
 * confirm. Never throws.
 *
 * No-ops when: there is no `navigator` (SSR), the browser has no
 * `serviceWorker` support, or no worker currently controls this page (e.g.
 * one was never installed, or the tab loaded before it took control) — in
 * that last case there is nothing to message, and since this session was
 * never controlled by a worker, no worker populated caches on its behalf.
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
 * Purge every trace of the signed-in user's offline data from this device:
 * cached book bytes/metadata (`leaf-books`), queued outbox writes
 * (`leaf-outbox`), and the service worker's cached reader documents.
 *
 * Runs all three concurrently. Never throws, and always settles within
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
  ]).then(() => undefined);

  await resolveWithin(legs, OVERALL_TIMEOUT_MS);
}
