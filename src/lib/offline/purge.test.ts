// Orchestrator tests for `purgeAllOfflineData`. `book-store` and `outbox`
// already have their own coverage for their real IndexedDB behaviour (see
// book-store.test.ts, which uses fake-indexeddb); here they're mocked so
// these tests are about ORCHESTRATION — do all three legs run, does a
// failure in one leave the others unaffected, and does the whole thing
// always settle — not about IndexedDB itself.
//
// jsdom cannot execute a real service worker, so `navigator.serviceWorker`
// is hand-mocked below as a minimal message-passing stand-in. The real
// postMessage round trip against the actual worker in service-worker.ts is
// NOT exercised by this file or by any other jsdom test in this repo (see
// docs/TESTING.md Tier 3) — that needs the Playwright harness.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./book-store", () => ({
  purgeCachedBooks: vi.fn(),
}));
vi.mock("./outbox", () => ({
  purgeOutbox: vi.fn(),
}));

import { purgeCachedBooks } from "./book-store";
import { purgeOutbox } from "./outbox";
import {
  purgeAllOfflineData,
  SW_ACK_TIMEOUT_MS,
  SW_PURGE_MESSAGE_TYPE,
  SW_PURGED_MESSAGE_TYPE,
  OVERALL_TIMEOUT_MS,
} from "./purge";

/** Minimal stand-in for `navigator.serviceWorker`: an EventTarget-ish object
 * whose `message` listeners can be triggered from a test via `emit()`. */
function installFakeServiceWorker(options: {
  controller?: { postMessage: (message: unknown) => void } | null;
} = {}) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const container = {
    controller:
      options.controller === undefined
        ? { postMessage: vi.fn() }
        : options.controller,
    addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: MessageEvent) => void) => {
      if (type === "message") listeners.delete(listener);
    },
  };

  Object.defineProperty(navigator, "serviceWorker", {
    value: container,
    configurable: true,
  });

  return {
    container,
    emit(data: unknown) {
      for (const listener of [...listeners]) {
        listener({ data } as MessageEvent);
      }
    },
  };
}

function removeServiceWorker() {
  // jsdom's `navigator` has no `serviceWorker` property by default — this
  // restores that "no support at all" baseline between tests.
  Reflect.deleteProperty(navigator, "serviceWorker");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(purgeCachedBooks).mockResolvedValue(undefined);
  vi.mocked(purgeOutbox).mockResolvedValue(undefined);
  removeServiceWorker();
});

afterEach(() => {
  removeServiceWorker();
  vi.useRealTimers();
});

describe("purgeAllOfflineData", () => {
  it("runs the book store purge, the outbox purge, and messages the service worker", async () => {
    const sw = installFakeServiceWorker();
    // Reply immediately, as a real worker would for an unblocked cache.delete.
    vi.mocked(sw.container.controller!.postMessage).mockImplementation(() => {
      queueMicrotask(() => sw.emit({ type: SW_PURGED_MESSAGE_TYPE }));
    });

    await purgeAllOfflineData();

    expect(purgeCachedBooks).toHaveBeenCalledTimes(1);
    expect(purgeOutbox).toHaveBeenCalledTimes(1);
    expect(sw.container.controller!.postMessage).toHaveBeenCalledWith({
      type: SW_PURGE_MESSAGE_TYPE,
    });
  });

  it("still purges the book store and outbox when there is no service worker support", async () => {
    // No navigator.serviceWorker at all (the common case — most jsdom-like
    // "old browser" or restricted environments).
    await purgeAllOfflineData();

    expect(purgeCachedBooks).toHaveBeenCalledTimes(1);
    expect(purgeOutbox).toHaveBeenCalledTimes(1);
  });

  it("does not post a message when a service worker exists but nothing controls this page yet", async () => {
    const sw = installFakeServiceWorker({ controller: null });

    await purgeAllOfflineData();

    expect(purgeCachedBooks).toHaveBeenCalledTimes(1);
    expect(purgeOutbox).toHaveBeenCalledTimes(1);
    // Nothing to assert "not called" on — there's no controller object to
    // spy on — the meaningful assertion is that the call above resolved at
    // all rather than hanging.
    void sw;
  });

  it("never rejects when the book store purge leg rejects unexpectedly", async () => {
    vi.mocked(purgeCachedBooks).mockRejectedValue(new Error("indexeddb blocked"));

    await expect(purgeAllOfflineData()).resolves.toBeUndefined();
    // The other leg still ran — one broken mechanism doesn't stop the rest.
    expect(purgeOutbox).toHaveBeenCalledTimes(1);
  });

  it("never rejects when the outbox purge leg rejects unexpectedly", async () => {
    vi.mocked(purgeOutbox).mockRejectedValue(new Error("indexeddb blocked"));

    await expect(purgeAllOfflineData()).resolves.toBeUndefined();
    expect(purgeCachedBooks).toHaveBeenCalledTimes(1);
  });

  it("never rejects even when every leg fails or is unavailable at once", async () => {
    vi.mocked(purgeCachedBooks).mockRejectedValue(new Error("blocked"));
    vi.mocked(purgeOutbox).mockRejectedValue(new Error("blocked"));
    // No service worker (removeServiceWorker() already ran in beforeEach).

    await expect(purgeAllOfflineData()).resolves.toBeUndefined();
  });

  it("gives up waiting on the service worker reply after SW_ACK_TIMEOUT_MS and still resolves", async () => {
    vi.useFakeTimers();
    const sw = installFakeServiceWorker();
    // Worker never replies — postMessage does nothing.

    const done = vi.fn();
    void purgeAllOfflineData().then(done);

    // Not yet: still within the ack window.
    await vi.advanceTimersByTimeAsync(SW_ACK_TIMEOUT_MS - 1);
    expect(done).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledTimes(1);
    void sw;
  });

  it("resolves via the overall timeout backstop even if a purge leg never settles at all", async () => {
    vi.useFakeTimers();
    // Simulate a genuinely stuck IndexedDB transaction: a leg whose promise
    // never resolves or rejects, which no per-leg timeout in this file
    // guards against directly — only the outer OVERALL_TIMEOUT_MS does.
    vi.mocked(purgeCachedBooks).mockReturnValue(new Promise(() => {}));

    const done = vi.fn();
    void purgeAllOfflineData().then(done);

    await vi.advanceTimersByTimeAsync(OVERALL_TIMEOUT_MS - 1);
    expect(done).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("Cache Storage is purged directly, not only via the worker", () => {
  /** Minimal `caches` stand-in. jsdom has none, which is why the tests above
   *  never needed one. */
  function installFakeCaches(names: string[]) {
    const deleted: string[] = [];
    const store = {
      keys: vi.fn(async () => [...names]),
      delete: vi.fn(async (key: string) => {
        deleted.push(key);
        return true;
      }),
    };
    Object.defineProperty(globalThis, "caches", {
      value: store,
      configurable: true,
      writable: true,
    });
    return { store, deleted };
  }

  afterEach(() => {
    Reflect.deleteProperty(globalThis as object, "caches");
  });

  it("deletes the reader cache even when no worker controls the page", async () => {
    // The load-bearing case: Cache Storage OUTLIVES the session that filled
    // it. A worker installed on an earlier visit can hold cached
    // authenticated reader documents while this page load has no controller
    // (first load after registration, or a tab that loaded before claim).
    // Messaging alone would skip the purge here and leave one user's reader
    // documents for the next person who signs in.
    installFakeServiceWorker({ controller: null });
    const { deleted } = installFakeCaches([
      "leaf-offline-reader",
      "leaf-offline-offline",
      "leaf-offline-static",
      "leaf-offline-meta",
    ]);

    await purgeAllOfflineData();

    expect(deleted).toEqual(["leaf-offline-reader"]);
  });

  it("leaves the offline shell, static and meta caches intact — only the reader cache holds anything user-specific", async () => {
    // leaf-offline-offline is the precached, auth-free `/offline` shelf: the
    // offline entry point once signed out. Deleting it on sign-out was the
    // actual defect this scoping fixes — nothing repopulates it at runtime
    // (precacheOfflineShell only runs on `install`), so a signed-out, offline
    // visitor was landing on the inline 503 fallback instead of the shelf.
    // leaf-offline-static (public build assets) and leaf-offline-meta (a
    // build id string) were never user-specific to begin with.
    installFakeServiceWorker({ controller: null });
    const { store } = installFakeCaches([
      "leaf-offline-reader",
      "leaf-offline-offline",
      "leaf-offline-static",
      "leaf-offline-meta",
    ]);

    await purgeAllOfflineData();

    expect(store.delete).not.toHaveBeenCalledWith("leaf-offline-offline");
    expect(store.delete).not.toHaveBeenCalledWith("leaf-offline-static");
    expect(store.delete).not.toHaveBeenCalledWith("leaf-offline-meta");
  });

  it("leaves caches it does not own alone", async () => {
    installFakeServiceWorker({ controller: null });
    const { deleted } = installFakeCaches([
      "leaf-offline-reader",
      "some-other-app-cache",
      "workbox-precache",
    ]);

    await purgeAllOfflineData();

    expect(deleted).toEqual(["leaf-offline-reader"]);
  });

  it("never throws when Cache Storage is unavailable", async () => {
    installFakeServiceWorker({ controller: null });
    Object.defineProperty(globalThis, "caches", {
      value: {
        keys: vi.fn(async () => {
          throw new Error("blocked by browser settings");
        }),
        delete: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    await expect(purgeAllOfflineData()).resolves.toBeUndefined();
  });
});

describe("local reading state is purged too", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("removes cached positions and locations tables", async () => {
    // Reading position is user data: how far through a book someone got. It
    // lives in localStorage (synchronously, so a hit lands before the first
    // `relocated` event — see locations-cache.ts's header) and must not
    // outlive the session that produced it any more than the bytes do.
    window.localStorage.setItem("leaf:position:v1:book-a", "{}");
    window.localStorage.setItem("leaf:position:v1:book-b", "{}");
    window.localStorage.setItem("leaf:locations:v1:book-a:1000", "[]");

    await purgeAllOfflineData();

    expect(window.localStorage.getItem("leaf:position:v1:book-a")).toBeNull();
    expect(window.localStorage.getItem("leaf:position:v1:book-b")).toBeNull();
    expect(
      window.localStorage.getItem("leaf:locations:v1:book-a:1000"),
    ).toBeNull();
  });

  it("leaves keys it does not own alone", async () => {
    window.localStorage.setItem("leaf:position:v1:book-a", "{}");
    window.localStorage.setItem("leaf:offline-owner:v1", "user-1");
    window.localStorage.setItem("some-other-app", "keep me");

    await purgeAllOfflineData();

    expect(window.localStorage.getItem("leaf:position:v1:book-a")).toBeNull();
    // The owner marker is managed by owner.ts, which clears it itself on a
    // sign-out — purging it here would race that.
    expect(window.localStorage.getItem("leaf:offline-owner:v1")).toBe("user-1");
    expect(window.localStorage.getItem("some-other-app")).toBe("keep me");
  });
});
