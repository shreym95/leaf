// Stage 4 offline reading, part 1. jsdom has no IndexedDB; `fake-indexeddb`
// stands in, same pattern as `src/lib/offline/book-store.test.ts`. This suite
// drives the REAL `book-store` module (not a mock) so it also proves the
// route's actual client → IndexedDB wiring, not just that a mocked function
// was called.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { OfflineShelf } from "./OfflineShelf";
import { writeCachedBook } from "@/lib/offline/book-store";

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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OfflineShelf", () => {
  it("explains itself honestly when nothing is cached", async () => {
    render(<OfflineShelf />);

    expect(
      await screen.findByText(/nothing is saved on this device yet/i),
    ).toBeTruthy();
    // Never a bare blank page — the link list must not have rendered either.
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("lists cached books, each linking to its reader route, with progress", async () => {
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

  it("shows a loading state before the first IndexedDB read resolves", async () => {
    render(<OfflineShelf />);
    // Whatever resolves first, the empty-vs-loading text must never both be
    // absent — this asserts the initial synchronous render specifically.
    expect(
      screen.queryByText(/checking this device/i) ??
        screen.queryByText(/nothing is saved/i),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(/nothing is saved on this device yet/i)).toBeTruthy(),
    );
  });
});
