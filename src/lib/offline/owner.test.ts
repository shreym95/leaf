// Confirmed HIGH-severity finding: offline reading persisted cached book
// bytes (`leaf-books`), queued writes (`leaf-outbox`) and authenticated
// reader documents (the service worker's Cache Storage) with nothing to stop
// a second person on the same device — offline, no auth possible — from
// reading the first person's books. The only purge trigger was an explicit
// Sign out click; any session that ended without one left everything intact.
//
// This suite drives `enforceOfflineOwner` against the REAL `book-store`
// module (fake-indexeddb, same pattern as book-store.test.ts) so the closing
// test proves the actual cache is gone, not that a mock was called.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState: { session: { user: { id: string } } | null } = {
  session: null,
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(async () => ({ data: { session: authState.session } })),
    },
  })),
}));

import { createClient } from "@/lib/supabase/client";
import { listCachedBooks, writeCachedBook } from "./book-store";
import { enforceOfflineOwner, getLocalSessionUserId } from "./owner";

const MARKER_KEY = "leaf:offline-owner:v1";

function signInAs(userId: string) {
  authState.session = { user: { id: userId } };
}

function signOut() {
  authState.session = null;
}

function bytesOf(n: number): ArrayBuffer {
  return new ArrayBuffer(n);
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
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getLocalSessionUserId", () => {
  it("returns the signed-in user's id with no error", async () => {
    signInAs("user-a");
    await expect(getLocalSessionUserId()).resolves.toBe("user-a");
  });

  it("returns null when there is no local session", async () => {
    signOut();
    await expect(getLocalSessionUserId()).resolves.toBeNull();
  });

  it("returns null, never throws, when the Supabase client can't be built (unconfigured / demo mode)", async () => {
    vi.mocked(createClient).mockImplementationOnce(() => {
      throw new Error("SupabaseNotConfiguredError");
    });
    await expect(getLocalSessionUserId()).resolves.toBeNull();
  });

  it("returns null, never throws, when getSession() itself throws", async () => {
    vi.mocked(createClient).mockReturnValueOnce({
      auth: {
        getSession: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await expect(getLocalSessionUserId()).resolves.toBeNull();
  });
});

describe("enforceOfflineOwner", () => {
  it("no local session: purges the cache and clears the marker", async () => {
    window.localStorage.setItem(MARKER_KEY, "user-a");
    await writeCachedBook("book-1", bytesOf(10), {
      title: "Dracula",
      author: "Bram Stoker",
    });
    signOut();

    await enforceOfflineOwner();

    await expect(listCachedBooks()).resolves.toEqual([]);
    expect(window.localStorage.getItem(MARKER_KEY)).toBeNull();
  });

  it("session present, no marker yet: claims it without purging (first run for an already signed-in user)", async () => {
    await writeCachedBook("book-1", bytesOf(10), {
      title: "Dracula",
      author: "Bram Stoker",
    });
    signInAs("user-a");

    await enforceOfflineOwner();

    expect(window.localStorage.getItem(MARKER_KEY)).toBe("user-a");
    await expect(listCachedBooks()).resolves.toHaveLength(1);
  });

  it("session present, marker matches: no-op", async () => {
    signInAs("user-a");
    await enforceOfflineOwner(); // claims it
    await writeCachedBook("book-1", bytesOf(10), {
      title: "Dracula",
      author: "Bram Stoker",
    });

    await enforceOfflineOwner(); // same user again

    expect(window.localStorage.getItem(MARKER_KEY)).toBe("user-a");
    await expect(listCachedBooks()).resolves.toHaveLength(1);
  });

  it("THE FIX: session present, marker differs (a second person's session) — purges the first user's cache and claims it for the new one", async () => {
    // User A opens a book. Nothing ever signs them out explicitly — the tab
    // is just closed (or the app is killed), exactly the scenario that used
    // to leave the cache intact for whoever is next.
    signInAs("user-a");
    await enforceOfflineOwner();
    await writeCachedBook("book-1", bytesOf(10), {
      title: "Dracula",
      author: "Bram Stoker",
    });
    await expect(listCachedBooks()).resolves.toHaveLength(1);

    // The device now boots with a different signed-in user.
    signInAs("user-b");
    await enforceOfflineOwner();

    // User A's book must be gone, and the device now belongs to user B.
    await expect(listCachedBooks()).resolves.toEqual([]);
    expect(window.localStorage.getItem(MARKER_KEY)).toBe("user-b");
  });

  it("is idempotent: calling it twice in a row for the same mismatch purges once and settles", async () => {
    window.localStorage.setItem(MARKER_KEY, "user-a");
    await writeCachedBook("book-1", bytesOf(10), {
      title: "Dracula",
      author: "Bram Stoker",
    });
    signInAs("user-b");

    await enforceOfflineOwner();
    await enforceOfflineOwner(); // redundant call — must not throw or re-corrupt state

    expect(window.localStorage.getItem(MARKER_KEY)).toBe("user-b");
    await expect(listCachedBooks()).resolves.toEqual([]);
  });

  it("never throws even when localStorage is blocked", async () => {
    signInAs("user-a");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    await expect(enforceOfflineOwner()).resolves.toBeUndefined();
  });
});
