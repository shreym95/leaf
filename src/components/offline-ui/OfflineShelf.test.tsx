// Stage 4 offline reading, part 1. jsdom has no IndexedDB; `fake-indexeddb`
// stands in, same pattern as `src/lib/offline/book-store.test.ts`. This suite
// drives the REAL `book-store` and `owner` modules (not mocks) so it also
// proves the route's actual client → IndexedDB wiring, not just that a mocked
// function was called.
//
// Confirmed HIGH-severity finding (see `src/lib/offline/owner.ts`): with no
// gate, this shelf listed whatever `leaf-books` held, on a route
// (`/offline`) that is deliberately auth-free — so a device that changed
// hands without an explicit sign-out showed the PREVIOUS user's cached books
// to whoever opened it next, offline, with no authentication anywhere in the
// path. The tests below marked "THE FIX" reproduce exactly that shape (cache
// populated under user A, then a boot under user B) and assert the shelf
// never renders user A's book.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

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

import { OfflineShelf } from "./OfflineShelf";
import { writeCachedBook } from "@/lib/offline/book-store";
import { enforceOfflineOwner } from "@/lib/offline/owner";

function signInAs(userId: string) {
  authState.session = { user: { id: userId } };
}

function signOut() {
  authState.session = null;
}

function bytesOf(n: number): ArrayBuffer {
  return new ArrayBuffer(n);
}

/**
 * `useIsOffline` reads `navigator.onLine`, and `beforeEach` below replaces
 * `window.navigator` wholesale (`vi.stubGlobal`) with a plain object rather
 * than the real `Navigator` instance, so `onLine` has to be an explicit own
 * property on that stub (spreading the real `navigator` does NOT copy it —
 * it's an accessor on `Navigator.prototype`, not an own property, so a bare
 * `{ ...navigator }` silently drops it). This mutates that same stub object,
 * same pattern as `OfflineIndicator.test.tsx`'s own `setOnLine`.
 */
function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
    new IDBFactory();
  vi.stubGlobal("navigator", {
    ...navigator,
    onLine: true,
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

describe("OfflineShelf", () => {
  it("explains itself honestly when nothing is cached, for the signed-in owner", async () => {
    signInAs("user-a");
    render(<OfflineShelf />);

    expect(
      await screen.findByText(/nothing is saved on this device yet/i),
    ).toBeTruthy();
    // Never a bare blank page — the link list must not have rendered either.
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("lists cached books, each linking to its reader route, with progress, for the signed-in owner", async () => {
    signInAs("user-a");
    await enforceOfflineOwner(); // claims the device for user-a, as boot would
    await writeCachedBook("book-1", bytesOf(10), {
      title: "Dracula",
      author: "Bram Stoker",
      percent: 0.42,
    });
    await writeCachedBook("book-2", bytesOf(10), {
      title: "Frankenstein",
      author: "Mary Shelley",
    });

    render(<OfflineShelf />);

    const dracula = await screen.findByRole("link", { name: /dracula/i });
    expect(dracula).toHaveAttribute("href", "/reader/book-1");
    expect(dracula).toHaveTextContent("42% read");

    const frankenstein = screen.getByRole("link", { name: /frankenstein/i });
    expect(frankenstein).toHaveAttribute("href", "/reader/book-2");
    expect(frankenstein).toHaveTextContent("Unread");
  });

  it("shows a loading state before the first check resolves", async () => {
    signInAs("user-a");
    render(<OfflineShelf />);
    // Whatever resolves first, the loading-vs-settled text must never both be
    // absent — this asserts the initial synchronous render specifically.
    expect(
      screen.queryByText(/checking this device/i) ??
        screen.queryByText(/nothing is saved/i) ??
        screen.queryByText(/sign in to see/i),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(/nothing is saved on this device yet/i)).toBeTruthy(),
    );
  });

  it("tells a signed-out visitor to sign in, rather than showing an empty or blank shelf", async () => {
    signOut();
    render(<OfflineShelf />);

    expect(
      await screen.findByText(/sign in to see the books saved on this device/i),
    ).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/nothing is saved/i)).toBeNull();
  });

  it("THE FIX: never shows a previous user's cached book to whoever the device boots as next", async () => {
    // User A opens a book and the device is never explicitly signed out —
    // just closed, exactly the case that used to leave the cache behind.
    signInAs("user-a");
    await enforceOfflineOwner();
    await writeCachedBook("book-1", bytesOf(10), {
      title: "Dracula",
      author: "Bram Stoker",
    });

    // The device now boots as a different signed-in user.
    signInAs("user-b");
    render(<OfflineShelf />);

    await waitFor(() =>
      expect(screen.getByText(/nothing is saved on this device yet/i)).toBeTruthy(),
    );
    expect(screen.queryByRole("link", { name: /dracula/i })).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("THE FIX: never shows a previous user's cached book when the device boots with no session at all", async () => {
    signInAs("user-a");
    await enforceOfflineOwner();
    await writeCachedBook("book-1", bytesOf(10), {
      title: "Dracula",
      author: "Bram Stoker",
    });

    signOut();
    render(<OfflineShelf />);

    expect(
      await screen.findByText(/sign in to see the books saved on this device/i),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /dracula/i })).toBeNull();
  });

  describe("the way out (defect 3)", () => {
    // CONTRACT CHANGE (offline-address fix): a signed-out visitor used to get
    // NO sign-in control at all while offline (just the generic "everything
    // else needs a connection" line) — the founder's brief for this fix
    // requires the sign-in control to be ALWAYS visible for a signed-out
    // reader, online or off, since it's their only way off this page. Offline
    // it must be honest instead of hidden: present, but disabled, with a
    // specific reason, and never an active link (a real `/login` link tapped
    // offline would round-trip through the service worker and land right
    // back on `/offline`).
    it("offline, signed out: the sign-in control is visible but disabled, with a reason", async () => {
      setOnLine(false);
      signOut();
      render(<OfflineShelf />);

      expect(
        await screen.findByText(/sign in to see the books saved on this device/i),
      ).toBeTruthy();

      // Present, but not a working link.
      expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
      const button = screen.getByRole("button", { name: /sign in/i });
      expect(button).toBeDisabled();
      expect(screen.getByText(/sign in needs a connection/i)).toBeTruthy();
    });

    it("online, signed out, then offline: the sign-in link becomes disabled with no remount", async () => {
      setOnLine(true);
      signOut();
      render(<OfflineShelf />);

      expect(
        await screen.findByRole("link", { name: /sign in/i }),
      ).toHaveAttribute("href", "/login");

      await act(async () => {
        setOnLine(false);
        window.dispatchEvent(new Event("offline"));
      });

      expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
      expect(
        await screen.findByRole("button", { name: /sign in/i }),
      ).toBeDisabled();

      // And back online, live, no refresh — the moment connectivity returns.
      await act(async () => {
        setOnLine(true);
        window.dispatchEvent(new Event("online"));
      });

      expect(
        await screen.findByRole("link", { name: /sign in/i }),
      ).toHaveAttribute("href", "/login");
    });

    it("offline, signed in with nothing cached: no link — just says the rest needs a connection", async () => {
      setOnLine(false);
      signInAs("user-a");
      render(<OfflineShelf />);

      expect(
        await screen.findByText(/nothing is saved on this device yet/i),
      ).toBeTruthy();
      expect(
        screen.getByText(/everything else here needs a connection/i),
      ).toBeTruthy();
      expect(
        screen.queryByRole("link", { name: /go to your library/i }),
      ).toBeNull();
    });

    it("online, signed out: a primary action to /login", async () => {
      setOnLine(true);
      signOut();
      render(<OfflineShelf />);

      const link = await screen.findByRole("link", { name: /sign in/i });
      expect(link).toHaveAttribute("href", "/login");
      expect(
        screen.queryByText(/everything else here needs a connection/i),
      ).toBeNull();
    });

    it("online, signed in: a primary action to /library — a different destination than signed-out", async () => {
      setOnLine(true);
      signInAs("user-a");
      render(<OfflineShelf />);

      const link = await screen.findByRole("link", {
        name: /go to your library/i,
      });
      expect(link).toHaveAttribute("href", "/library");
    });

    it("reacts live: the way out appears with no refresh once connectivity returns", async () => {
      setOnLine(false);
      signInAs("user-a");
      render(<OfflineShelf />);

      // Settled, offline: no link yet.
      expect(
        await screen.findByText(/nothing is saved on this device yet/i),
      ).toBeTruthy();
      expect(
        screen.queryByRole("link", { name: /go to your library/i }),
      ).toBeNull();

      // The network returns while sitting on this exact page — no remount.
      await act(async () => {
        setOnLine(true);
        window.dispatchEvent(new Event("online"));
      });

      expect(
        await screen.findByRole("link", { name: /go to your library/i }),
      ).toBeTruthy();
      expect(
        screen.queryByText(/everything else here needs a connection/i),
      ).toBeNull();
    });
  });
});
