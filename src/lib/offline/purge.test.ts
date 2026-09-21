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
