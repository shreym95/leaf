// Offline-owner guard — closes the cross-user offline-data exposure.
//
// LOGIC ONLY — no design/component imports (ESLint seam rule, matches
// book-store.ts / outbox.ts / purge.ts).
//
// ---------------------------------------------------------------------------
// The exposure this closes
// ---------------------------------------------------------------------------
// Offline reading persists three things on the device (cached book bytes in
// `leaf-books`, queued writes in `leaf-outbox`, authenticated `/reader/<id>`
// documents in the service worker's Cache Storage) that used to vanish with
// the tab. The only thing that ever purges them is `purgeAllOfflineData()`
// (`./purge.ts`), and it is wired to exactly two triggers: the Sign out menu
// item and account deletion. Any session that ends WITHOUT one of those —
// closing the tab, closing the browser, the OS killing it, a mobile PWA being
// force-quit — leaves everything intact for whoever opens this device next.
//
// This module is the backstop for every one of those un-signed-out endings:
// a boot-time check that compares "whose data is this?" against "who is
// signed in right now?" and purges the moment those two disagree, with no
// dependency on how the previous session ended.
//
// ---------------------------------------------------------------------------
// Why `getSession()`, never `getUser()` — and what it does NOT guarantee
// ---------------------------------------------------------------------------
// `getUser()` re-validates against the Supabase auth server — a network call
// that, by construction, cannot succeed in the exact scenario this guard
// exists for (the device is offline, reading a cached book). `getSession()`
// reads the session persisted locally by the browser client
// (`src/lib/supabase/client.ts`, a `@supabase/ssr` client backed by cookies
// so the server can read it too).
//
// It needs no network ONLY while the stored access token is unexpired
// (~1 hour). After that auth-js tries to refresh, the refresh fails offline
// with an `AuthRetryableFetchError`, the stored session is deliberately kept,
// and `getSession()` RESOLVES `{ session: null, error }`. "No session" is
// therefore ambiguous: `./identity.ts` tells a real sign-out apart from this
// "unverifiable" state (and explains why the owner marker is a safe fallback
// for it). This guard must NOT purge when unverifiable — that would delete
// every cached book an hour into a flight.
//
// ---------------------------------------------------------------------------
// The marker
// ---------------------------------------------------------------------------
// The marker's read/write helpers live in `./identity.ts` (shared with
// `outbox.ts`, which cannot import this module without a cycle through
// `./purge`). Everything here is best-effort in the same sense as the rest of
// the offline stack: a miss, a blocked/unavailable `localStorage`, or a
// Supabase client that isn't configured must all degrade to the SAFEST
// assumption ("nobody is signed in locally") rather than throw into a layout
// render or leave the previous device state in place.

import { createClient } from "@/lib/supabase/client";
import {
  clearOwnerMarker,
  identityUserId,
  readLocalIdentity,
  readOwnerMarker,
  writeOwnerMarker,
  type LocalIdentity,
} from "./identity";
import { purgeAllOfflineData } from "./purge";

/** The device's identity, never throwing: no window (SSR) or a client that
 * can't be built (unconfigured / demo mode, `src/lib/demo/flag.ts` —
 * `createClient()` throws `SupabaseNotConfiguredError`) both read as
 * signed-out. */
async function currentIdentity(): Promise<LocalIdentity> {
  try {
    if (typeof window === "undefined") return { kind: "signed-out" };
    return await readLocalIdentity(createClient());
  } catch {
    return { kind: "signed-out" };
  }
}

/**
 * The user id this device is signed in as, with no network round trip — see
 * `./identity.ts`. The session's id when signed in; the owner marker's id
 * (or `null` if none) when the session is unverifiable (access token expired
 * while offline); `null` when signed out, when Supabase isn't configured, or
 * when reading it throws. Never throws.
 */
export async function getLocalSessionUserId(): Promise<string | null> {
  return identityUserId(await currentIdentity());
}

/**
 * Compare the locally signed-in user against whoever this device's offline
 * caches were last claimed for, and purge the instant they disagree. Must be
 * called at boot, before anything reads `leaf-books` / `leaf-outbox` / the
 * service worker's caches for display (see `OfflineShelf`, which also calls
 * this directly rather than relying solely on timing).
 *
 * Five cases:
 *   - signed out (no stored session, or a non-retryable auth failure) →
 *     purge everything, clear the marker. The device has no one to attribute
 *     the cache to, which is exactly the "session ended without signing out"
 *     state this guard exists for.
 *   - unverifiable (stored session exists but its token can't be refreshed
 *     offline — see `./identity.ts`) → do NOTHING: no purge, no claim, marker
 *     untouched. We cannot tell who is signed in, but nothing says it changed.
 *   - session, no marker yet      → claim it, purge nothing. The ordinary
 *     first run for an existing signed-in user (or the first boot after this
 *     guard shipped) — there is nothing to distrust yet.
 *   - session, marker matches     → no-op.
 *   - session, marker differs     → a second person's session on this
 *     device. Purge, then claim the marker for them.
 *
 * Never throws (every step it calls is itself non-throwing, but this is
 * wrapped again as a hard guarantee — it runs from a layout's `useEffect` and
 * must never break the render). Idempotent and safe to call repeatedly,
 * concurrently, or from more than one component in the same boot: the worst
 * a redundant call can do is re-run a no-op comparison or re-purge an already
 * empty cache.
 */
export async function enforceOfflineOwner(): Promise<void> {
  try {
    const identity = await currentIdentity();

    if (identity.kind === "unverifiable") return;

    if (identity.kind === "signed-out") {
      await purgeAllOfflineData();
      clearOwnerMarker();
      return;
    }

    const { userId } = identity;
    const marker = readOwnerMarker();

    if (marker === undefined) {
      writeOwnerMarker(userId);
      return;
    }

    if (marker === userId) {
      return;
    }

    await purgeAllOfflineData();
    writeOwnerMarker(userId);
  } catch {
    // This guard must never be the thing that breaks a render. Worst case:
    // the mismatch is caught on the next call instead of this one.
  }
}
