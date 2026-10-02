// "Who is signed in on this device?" — the one shared, offline-safe answer.
//
// LOGIC ONLY — no design/component imports (ESLint seam rule). Browser-safe:
// the only import is a type-guard from `@supabase/supabase-js`, which the
// outbox already pulls in. This module imports NOTHING from `./owner`,
// `./purge` or `./outbox`, so all three can depend on it without a cycle
// (`owner` -> `purge` -> `outbox`; `outbox` must never import `owner`).
//
// ---------------------------------------------------------------------------
// What `getSession()` really does offline
// ---------------------------------------------------------------------------
// `getSession()` needs no network ONLY while the stored access token is
// unexpired (~1 hour by default). Once it has expired, auth-js tries to
// refresh it. Offline that fails with an `AuthRetryableFetchError`, and
// auth-js deliberately does NOT drop the stored session for a retryable
// error (the refresh token is still good; the network is just gone). The
// call then RESOLVES — it does not throw —
// `{ data: { session: null }, error: <AuthRetryableFetchError> }`.
//
// So "no session" is ambiguous, and treating it as "signed out" is wrong
// after about an hour offline (a long flight — the very case offline reading
// exists for): it would purge every cached book and drop queued writes. The
// three genuinely different situations are:
//
//   signed-in    `getSession()` returned a session.
//   unverifiable no session, but the error is retryable: the stored session
//                still exists and simply can't be refreshed right now.
//   signed-out   everything else — no session and no error (a real sign-out
//                removes the stored session), or a non-retryable error (a
//                server-revoked session fails refresh non-retryably and
//                auth-js removes it). A throw also lands here.
//
// ---------------------------------------------------------------------------
// Why the owner marker is a safe fallback for `unverifiable`
// ---------------------------------------------------------------------------
// The marker (`leaf:offline-owner:v1`) is the user id of the last session
// this device VERIFIED. The `unverifiable` state only arises while this
// browser profile still stores a refresh token, so whoever is holding the
// device already holds that account's credentials — attributing offline work
// to the marker's user grants them nothing they don't already have. And RLS
// still guards every replayed write server-side: a queued write scoped to the
// wrong id is rejected and dropped, never applied cross-user.
//
// Marker conventions follow `src/reader/locations-cache.ts`: `localStorage`
// (synchronous, survives a full browser close), a versioned key, a storage
// guard that survives SSR and blocked storage, reads that return `undefined`
// rather than throwing, and best-effort writes.

import { isAuthRetryableFetchError } from "@supabase/supabase-js";

/** Bumped when the stored shape changes, which orphans every older entry. */
const SCHEMA = 1;
export const OWNER_MARKER_KEY = `leaf:offline-owner:v${SCHEMA}`;

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
 * is unavailable). Never throws. */
export function readOwnerMarker(): string | undefined {
  const store = storage();
  if (!store) return undefined;
  try {
    return store.getItem(OWNER_MARKER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Claim the offline caches for `userId`. Silent on failure — this is a
 * nicety, not state; the worst case of a failed write is re-running the
 * comparison (and possibly re-purging) on the next boot. */
export function writeOwnerMarker(userId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(OWNER_MARKER_KEY, userId);
  } catch {
    // Storage is unusable (quota, blocked). Nothing more we can do here.
  }
}

export function clearOwnerMarker(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(OWNER_MARKER_KEY);
  } catch {
    // Best-effort, same as writeOwnerMarker.
  }
}

export type LocalIdentity =
  | { kind: "signed-in"; userId: string }
  | { kind: "unverifiable"; userId: string | undefined }
  | { kind: "signed-out" };

/** The slice of a Supabase client this module needs. The real client's
 * `getSession()` result is assignable to this (its `error` is `null` or an
 * `AuthError`). */
export interface IdentityClient {
  auth: {
    getSession: () => Promise<{
      data: { session: { user: { id: string } } | null };
      error?: unknown;
    }>;
  };
}

/**
 * Classify who is signed in on this device — see the module header for the
 * three states and why `unverifiable` exists. No network call is attempted
 * here beyond whatever `getSession()` does itself. Never throws: a thrown
 * `getSession()` is reported as `signed-out`.
 */
export async function readLocalIdentity(
  supabase: IdentityClient,
): Promise<LocalIdentity> {
  try {
    const { data, error } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;
    if (userId) return { kind: "signed-in", userId };
    if (error && isAuthRetryableFetchError(error)) {
      return { kind: "unverifiable", userId: readOwnerMarker() };
    }
    return { kind: "signed-out" };
  } catch {
    return { kind: "signed-out" };
  }
}

/** The user id to attribute local work to, or `null` for "no identity":
 * the session's id when signed in, the owner marker when unverifiable (null
 * if none), `null` when signed out. */
export function identityUserId(identity: LocalIdentity): string | null {
  switch (identity.kind) {
    case "signed-in":
      return identity.userId;
    case "unverifiable":
      return identity.userId ?? null;
    case "signed-out":
      return null;
  }
}
