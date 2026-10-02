// The expired-token-while-offline case for the owner guard. auth-js RESOLVES
// `{ session: null, error: AuthRetryableFetchError }` (it does not throw) once
// the access token has expired and the refresh can't reach the network; the
// stored session survives. That must NOT be read as a sign-out — doing so
// purged every cached book an hour into a flight. Real error classes, real
// `book-store` (fake-indexeddb), so the assertions are about the actual cache.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
} from "@supabase/supabase-js";

type AuthState = {
  session: { user: { id: string } } | null;
  error: unknown;
};
const authState: AuthState = { session: null, error: null };

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: authState.session },
        error: authState.error,
      })),
    },
  })),
}));

import { listCachedBooks, writeCachedBook } from "./book-store";
import { OWNER_MARKER_KEY } from "./identity";
import { enforceOfflineOwner, getLocalSessionUserId } from "./owner";

function signInAs(userId: string) {
  authState.session = { user: { id: userId } };
  authState.error = null;
}
function goUnverifiable() {
  authState.session = null;
  authState.error = new AuthRetryableFetchError("Failed to fetch", 0);
}
function signOut() {
  authState.session = null;
  authState.error = null;
}
async function cacheABook() {
  await writeCachedBook("book-1", new ArrayBuffer(10), {
    title: "Dracula",
    author: "Bram Stoker",
  });
}

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
    new IDBFactory();
  vi.stubGlobal("navigator", {
    ...navigator,
    storage: {
      estimate: vi.fn(async () => ({ quota: 1024 * 1024 * 1024, usage: 0 })),
      persist: vi.fn(async () => true),
    },
  });
  window.localStorage.clear();
  signOut();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("enforceOfflineOwner — unverifiable session (expired token, offline)", () => {
  it("does NOT purge the cache and leaves the marker untouched", async () => {
    signInAs("user-a");
    await enforceOfflineOwner(); // claims the device for user-a
    await cacheABook();

    goUnverifiable(); // token expired mid-flight, refresh can't reach the network
    await enforceOfflineOwner();

    await expect(listCachedBooks()).resolves.toHaveLength(1);
    expect(window.localStorage.getItem(OWNER_MARKER_KEY)).toBe("user-a");
  });

  it("does NOT claim the device when there is no marker yet", async () => {
    await cacheABook();
    goUnverifiable();

    await enforceOfflineOwner();

    await expect(listCachedBooks()).resolves.toHaveLength(1);
    expect(window.localStorage.getItem(OWNER_MARKER_KEY)).toBeNull();
  });

  it("still purges and clears the marker on a real sign-out (no session, no error)", async () => {
    signInAs("user-a");
    await enforceOfflineOwner();
    await cacheABook();

    signOut();
    await enforceOfflineOwner();

    await expect(listCachedBooks()).resolves.toEqual([]);
    expect(window.localStorage.getItem(OWNER_MARKER_KEY)).toBeNull();
  });

  it("still purges when the server revoked the session (non-retryable error)", async () => {
    signInAs("user-a");
    await enforceOfflineOwner();
    await cacheABook();

    authState.session = null;
    authState.error = new AuthApiError(
      "Invalid Refresh Token",
      400,
      "refresh_token_not_found",
    );
    await enforceOfflineOwner();

    await expect(listCachedBooks()).resolves.toEqual([]);
    expect(window.localStorage.getItem(OWNER_MARKER_KEY)).toBeNull();
  });

  it("still purges on an account switch (verified session for a different user)", async () => {
    signInAs("user-a");
    await enforceOfflineOwner();
    await cacheABook();

    signInAs("user-b");
    await enforceOfflineOwner();

    await expect(listCachedBooks()).resolves.toEqual([]);
    expect(window.localStorage.getItem(OWNER_MARKER_KEY)).toBe("user-b");
  });
});

describe("getLocalSessionUserId — unverifiable session", () => {
  it("returns the marker's id", async () => {
    window.localStorage.setItem(OWNER_MARKER_KEY, "user-a");
    goUnverifiable();
    await expect(getLocalSessionUserId()).resolves.toBe("user-a");
  });

  it("returns null when there is no marker", async () => {
    goUnverifiable();
    await expect(getLocalSessionUserId()).resolves.toBeNull();
  });

  it("returns null on a real sign-out even with a marker present", async () => {
    window.localStorage.setItem(OWNER_MARKER_KEY, "user-a");
    signOut();
    await expect(getLocalSessionUserId()).resolves.toBeNull();
  });
});
