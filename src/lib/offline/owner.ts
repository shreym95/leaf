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
// Why `getSession()`, never `getUser()`
// ---------------------------------------------------------------------------
// `getUser()` re-validates against the Supabase auth server — a network call
// that, by construction, cannot succeed in the exact scenario this guard
// exists for (the device is offline, reading a cached book). `getSession()`
// reads the session already persisted locally by the browser client
// (`src/lib/supabase/client.ts`, a `@supabase/ssr` client backed by cookies
// so the server can read it too) and resolves from that alone — no network,
// works offline, and is exactly "who does this browser profile currently
// believe is signed in" rather than "is that still valid right now."
//
// ---------------------------------------------------------------------------
// The marker
// ---------------------------------------------------------------------------
// Conventions follow `src/reader/locations-cache.ts`: `localStorage`
// (synchronous, survives a full browser close, no migration needed for a
// single small value), a versioned key prefix, a storage guard that survives
// SSR *and* blocked storage, reads that return `undefined` rather than
// throwing, and best-effort writes.
//
// Everything here is best-effort in the same sense as the rest of the offline
// stack: a miss, a blocked/unavailable `localStorage`, or a Supabase client
// that isn't configured must all degrade to the SAFEST assumption ("nobody is
// signed in locally") rather than throw into a layout render or leave the
// previous device state in place.

import { createClient } from "@/lib/supabase/client";
import { purgeAllOfflineData } from "./purge";

/** Bumped when the stored shape changes, which orphans every older entry. */
const SCHEMA = 1;
const MARKER_KEY = `leaf:offline-owner:v${SCHEMA}`;

function storage(): Storage | undefined {
  try {
    // Absent during SSR and in a jsdom test without a storage shim; throws
    // outright in a browser configured to block site data.
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** The user id this device's offline caches were last claimed for, or
 * `undefined` if there is no marker (never cached anything yet, or storage
 * is unavailable). */
function readOwnerMarker(): string | undefined {
  const store = storage();
  if (!store) return undefined;
  try {
    return store.getItem(MARKER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Claim the offline caches for `userId`. Silent on failure — this is a
 * nicety, not state; the worst case of a failed write is re-running the
 * comparison (and possibly re-purging) on the next boot. */
function writeOwnerMarker(userId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(MARKER_KEY, userId);
  } catch {
    // Storage is unusable (quota, blocked). Nothing more we can do here.
  }
}

function clearOwnerMarker(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(MARKER_KEY);
  } catch {
    // Best-effort, same as writeOwnerMarker.
  }
}

/**
 * The current local session's user id, with NO network round trip — see the
 * module header for why `getSession()` and not `getUser()`. Returns `null`
 * when there is no stored session, when Supabase isn't configured (demo mode,
 * `src/lib/demo/flag.ts` — `createClient()` throws `SupabaseNotConfiguredError`
 * in that case, caught below same as any other failure), or when reading it
 * throws for any other reason. Never throws.
 */
export async function getLocalSessionUserId(): Promise<string | null> {
  try {
    if (typeof window === "undefined") return null;

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Compare the locally signed-in user against whoever this device's offline
 * caches were last claimed for, and purge the instant they disagree. Must be
 * called at boot, before anything reads `leaf-books` / `leaf-outbox` / the
 * service worker's caches for display (see `OfflineShelf`, which also calls
 * this directly rather than relying solely on timing).
 *
 * Four cases:
 *   - no local session            → purge everything, clear the marker. The
 *     device has no one to attribute the cache to, which is exactly the
 *     "session ended without signing out" state this guard exists for.
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
    const userId = await getLocalSessionUserId();

    if (!userId) {
      await purgeAllOfflineData();
      clearOwnerMarker();
      return;
    }

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
