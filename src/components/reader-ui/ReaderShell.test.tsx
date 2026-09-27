import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReaderShell } from "./ReaderShell";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import {
  useReaderSettings,
  READER_SETTINGS_DEFAULTS,
} from "@/store/reader-settings";

// Engine + position tracker are mocked: this test is about the SHELL's wiring —
// that a settings change actually reaches `controller.applySettings`.
const h = vi.hoisted(() => ({
  applySettings: vi.fn(),
  destroy: vi.fn(),
  relayout: vi.fn(),
  next: vi.fn(async () => {}),
  prev: vi.fn(async () => {}),
  attach: vi.fn(async () => {}),
  goTo: vi.fn(async () => {}),
  currentChapterLabel: vi.fn((): string | undefined => undefined),
  chapterLabelForCfi: vi.fn((_cfi: string): string | undefined => undefined),
  toc: vi.fn(() => [] as { href: string; label: string }[]),
  onRelocated: vi.fn((_cb: (loc: unknown) => void) => () => {}),
  restore: vi.fn(async () => true),
  // Default: nobody ever calls back (no sync offer fires) — the existing
  // tests exercise none of this. Individual tests override with
  // `mockImplementation` to capture and invoke the callback.
  onSyncOffer: vi.fn((_cb: (offer: { cfi: string }) => void) => () => {}),
  stop: vi.fn(),
}));

vi.mock("@/reader/engine", () => ({
  createReader: vi.fn(async () => ({
    attach: h.attach,
    next: h.next,
    prev: h.prev,
    goTo: h.goTo,
    currentChapterLabel: h.currentChapterLabel,
    chapterLabelForCfi: h.chapterLabelForCfi,
    toc: h.toc,
    relayout: h.relayout,
    applySettings: h.applySettings,
    onRelocated: h.onRelocated,
    sectionCount: 12,
    destroy: h.destroy,
  })),
}));

vi.mock("@/reader/position", () => ({
  trackPosition: vi.fn(() => ({
    restore: h.restore,
    onSyncOffer: h.onSyncOffer,
    stop: h.stop,
  })),
}));

vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: false,
  createClient: () => {
    throw new Error("not configured");
  },
}));

// The book-store cache is a separate concern (see book-store.test.ts) — this
// suite only asserts ReaderShell's cache-first WIRING: a hit skips `fetch`
// entirely, a miss fetches then populates the cache, and with neither the
// existing error state is unchanged.
const bookStore = vi.hoisted(() => ({
  readCachedBook: vi.fn(async (): Promise<ArrayBuffer | undefined> => undefined),
  writeCachedBook: vi.fn(async () => {}),
  updateCachedBookProgress: vi.fn(async () => {}),
}));

vi.mock("@/lib/offline/book-store", () => ({
  readCachedBook: bookStore.readCachedBook,
  writeCachedBook: bookStore.writeCachedBook,
  updateCachedBookProgress: bookStore.updateCachedBookProgress,
}));

// The offline owner guard runs before the cache read (see ReaderShell). Its
// own behaviour is covered in owner.test.ts; here we only need to observe the
// ORDER — the gate must resolve before `readCachedBook` is allowed to look,
// or a bookmarked deep link could serve one stale read out of a cache that is
// about to be purged.
const owner = vi.hoisted(() => ({
  enforceOfflineOwner: vi.fn(async () => {}),
}));

vi.mock("@/lib/offline/owner", () => ({
  enforceOfflineOwner: owner.enforceOfflineOwner,
}));

const INITIAL = {
  fontFamily: "serif" as const,
  fontSize: 1.06,
  lineSpacing: 1.62,
  margins: "normal" as const,
  theme: "night" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks wipes call history but not implementations — reset the ones
  // individual tests override.
  h.toc.mockReturnValue([]);
  h.currentChapterLabel.mockReturnValue(undefined);
  h.chapterLabelForCfi.mockReturnValue(undefined);
  h.onSyncOffer.mockImplementation((_cb: (offer: { cfi: string }) => void) => () => {});
  useReaderSettings.setState({ ...READER_SETTINGS_DEFAULTS });
  // Default: a cache miss, so the existing fetch-driven tests keep working
  // unchanged. Individual tests override with a resolved value for a hit.
  bookStore.readCachedBook.mockImplementation(async () => undefined);
  bookStore.writeCachedBook.mockImplementation(async () => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderShell() {
  return render(
    <ThemeProvider>
      <ReaderShell
        bookId="book-1"
        title="Frankenstein"
        author="Mary Shelley"
        fileUrl="https://example.test/book.epub"
        userId="user-1"
        initialSettings={INITIAL}
      />
    </ThemeProvider>,
  );
}

async function ready() {
  await waitFor(() => expect(h.attach).toHaveBeenCalled());
  await waitFor(() => expect(h.restore).toHaveBeenCalled());
}

describe("ReaderShell — settings reach the engine", () => {
  it("pushes a font-size change through to applySettings", async () => {
    renderShell();
    await ready();
    h.applySettings.mockClear();

    act(() => useReaderSettings.getState().setFontSize(1.3));

    await waitFor(() =>
      expect(h.applySettings).toHaveBeenCalledWith(
        expect.objectContaining({ fontSize: 1.3 }),
      ),
    );
  });

  it("pushes font family, spacing, margins and theme changes too", async () => {
    renderShell();
    await ready();

    for (const [fn, key, value] of [
      [() => useReaderSettings.getState().setFontFamily("legible"), "fontFamily", "legible"],
      [() => useReaderSettings.getState().setLineSpacing(1.85), "lineSpacing", 1.85],
      [() => useReaderSettings.getState().setMargins("wide"), "margins", "wide"],
      [() => useReaderSettings.getState().setTheme("day"), "theme", "day"],
    ] as [() => void, string, unknown][]) {
      h.applySettings.mockClear();
      act(fn);
      await waitFor(() =>
        expect(h.applySettings).toHaveBeenCalledWith(
          expect.objectContaining({ [key]: value }),
        ),
      );
    }
  });

  it("drives the engine from the deck's text-size stepper", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();

    // The reading-settings sheet (font family, spacing, margins) was removed
    // from the dock: too many options for the job (founder, 2026-09-09). Text
    // size is the one typographic control that stayed, and it is in the deck.
    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    h.applySettings.mockClear();
    await user.click(screen.getByRole("button", { name: "Increase text size" }));

    await waitFor(() => {
      expect(h.applySettings).toHaveBeenCalled();
      const last = h.applySettings.mock.lastCall?.[0] as { fontSize: number };
      expect(last.fontSize).toBeGreaterThan(1.06);
    });
  });

  it("opens the deck from the resting pill and closes it on a page turn", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();

    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    const deck = screen.getByRole("region", { name: "Reading controls" });
    expect(deck).not.toHaveAttribute("inert");

    // The deck's own `‹` / `›` turn the page but leave the deck up.
    await user.click(within(deck).getByRole("button", { name: "Next page" }));
    expect(h.next).toHaveBeenCalledTimes(1);
    expect(deck).not.toHaveAttribute("inert");

    // A page turn from the keyboard (outside the deck) closes it.
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(deck).toHaveAttribute("inert"));
    expect(h.next).toHaveBeenCalledTimes(2);
  });

  it("toggles the theme from the dock through the registry", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();

    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    // Registry order is [day, night]; INITIAL theme is night → switch reads on.
    const toggle = screen.getByRole("switch", { name: /night theme/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);
    expect(useReaderSettings.getState().theme).toBe("day");
    expect(
      screen.getByRole("switch", { name: /night theme/i }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("routes the dock's contents popover through the engine's goTo", async () => {
    h.toc.mockReturnValue([
      { href: "ch1.html", label: "Letter 1" },
      { href: "ch2.html", label: "Chapter 2" },
    ]);
    const user = userEvent.setup();
    renderShell();
    await ready();

    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    await user.click(screen.getByRole("button", { name: "Table of contents" }));
    await user.click(screen.getByRole("button", { name: "Chapter 2" }));

    expect(h.goTo).toHaveBeenCalledWith("ch2.html");
  });

  it("offers a way back after a jump, and takes it", async () => {
    // Every non-linear move is destructive; this is the only undo in the
    // reader, and it is what makes chapter/bookmark navigation safe to ship.
    h.toc.mockReturnValue([{ href: "ch2.html", label: "Chapter 2" }]);
    h.currentChapterLabel.mockReturnValue("4");
    let emit: ((loc: unknown) => void) | undefined;
    h.onRelocated.mockImplementation((cb: (loc: unknown) => void) => {
      emit = cb;
      return () => {};
    });

    const user = userEvent.setup();
    renderShell();
    await ready();
    await act(async () => {
      emit?.({ cfi: "epubcfi(/6/8!/4/2)", percent: 0.34 });
    });

    // No jump yet — nothing to go back to.
    expect(screen.queryByRole("button", { name: /^Return to/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    await user.click(screen.getByRole("button", { name: "Table of contents" }));
    await user.click(screen.getByRole("button", { name: "Chapter 2" }));

    // A bare TOC ordinal is shown as "Ch. 4", not a hanging number.
    const back = await screen.findByRole("button", { name: "Return to Ch. 4" });
    h.goTo.mockClear();
    await user.click(back);

    expect(h.goTo).toHaveBeenCalledWith("epubcfi(/6/8!/4/2)");
    expect(screen.queryByRole("button", { name: /^Return to/ })).toBeNull();
  });

  it("clears the way back once the reader has settled in", async () => {
    // Not a timer: someone who jumps to check something often reads a page or
    // two there, and a timeout would pull the rope away while it is wanted.
    h.toc.mockReturnValue([{ href: "ch2.html", label: "Chapter 2" }]);
    let emit: ((loc: unknown) => void) | undefined;
    h.onRelocated.mockImplementation((cb: (loc: unknown) => void) => {
      emit = cb;
      return () => {};
    });

    const user = userEvent.setup();
    renderShell();
    await ready();
    await act(async () => {
      emit?.({ cfi: "epubcfi(/6/8!/4/2)", percent: 0.34 });
    });

    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    await user.click(screen.getByRole("button", { name: "Table of contents" }));
    await user.click(screen.getByRole("button", { name: "Chapter 2" }));
    expect(await screen.findByRole("button", { name: /^Return to/ })).toBeTruthy();

    for (let i = 0; i < 9; i++) {
      await user.keyboard("{ArrowRight}");
    }

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Return to/ })).toBeNull(),
    );
  });

  it("dismissing the way-back chip hides it without navigating, and a later jump brings it back", async () => {
    // The founder found the chip persistent and asked for an explicit ×
    // (not a clock — a timeout would retract it while still wanted). This is
    // that control, exercised end-to-end through the shell.
    h.toc.mockReturnValue([{ href: "ch2.html", label: "Chapter 2" }]);
    h.currentChapterLabel.mockReturnValue("4");
    let emit: ((loc: unknown) => void) | undefined;
    h.onRelocated.mockImplementation((cb: (loc: unknown) => void) => {
      emit = cb;
      return () => {};
    });

    const user = userEvent.setup();
    renderShell();
    await ready();
    await act(async () => {
      emit?.({ cfi: "epubcfi(/6/8!/4/2)", percent: 0.34 });
    });

    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    await user.click(screen.getByRole("button", { name: "Table of contents" }));
    await user.click(screen.getByRole("button", { name: "Chapter 2" }));

    await screen.findByRole("button", { name: "Return to Ch. 4" });
    h.goTo.mockClear();
    await user.click(
      screen.getByRole("button", { name: "Dismiss return to Ch. 4" }),
    );

    // Gone, and dismissing is not itself a navigation.
    expect(screen.queryByRole("button", { name: /^Return to/ })).toBeNull();
    expect(h.goTo).not.toHaveBeenCalled();

    // Per-jump, not permanent: jumping again brings it straight back.
    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    await user.click(screen.getByRole("button", { name: "Table of contents" }));
    await user.click(screen.getByRole("button", { name: "Chapter 2" }));
    expect(
      await screen.findByRole("button", { name: "Return to Ch. 4" }),
    ).toBeTruthy();
  });

  it("does not dismiss the deck when the top bar itself is pressed", async () => {
    // The deck's outside-tap dismiss used to fire on the top bar too: it closed
    // the deck on `pointerdown`, the bar went `inert`, and the `click` never
    // landed — Library and the fullscreen toggle silently did nothing while the
    // deck was open. Asserted at the `pointerdown` level because that is where
    // the bug lives; jsdom does not enforce `inert`, so a full click would pass
    // either way and prove nothing.
    const user = userEvent.setup();
    renderShell();
    await ready();

    await user.keyboard("f"); // immersive — the bar only shows with the deck
    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    const deck = screen.getByRole("region", { name: "Reading controls" });
    expect(deck).not.toHaveAttribute("aria-hidden", "true");

    fireEvent.pointerDown(screen.getByRole("link", { name: /library/i }));
    expect(deck).not.toHaveAttribute("aria-hidden", "true");
  });

  it("still dismisses the deck when the page itself is pressed", async () => {
    // The other half of the same rule — chrome is exempt, the page is not.
    const user = userEvent.setup();
    renderShell();
    await ready();

    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    const deck = screen.getByRole("region", { name: "Reading controls" });
    expect(deck).not.toHaveAttribute("aria-hidden", "true");

    fireEvent.pointerDown(screen.getByRole("main", { name: "Reader" }));
    await waitFor(() => expect(deck).toHaveAttribute("aria-hidden", "true"));
  });

  it("keeps the bookmark list reachable from the contents popover", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();

    // The ribbon on the frame's top edge is gone — the pod creates bookmarks
    // and the contents popover's second tab lists them.
    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    await user.click(screen.getByRole("button", { name: "Table of contents" }));
    await user.click(screen.getByRole("tab", { name: "Bookmarks" }));

    expect(screen.getByText(/No bookmarks yet/i)).toBeTruthy();
  });

  it("seeds the engine with the server-provided settings", async () => {
    const { createReader } = await import("@/reader/engine");
    renderShell();
    await ready();
    expect(createReader).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fontSize: 1.06, theme: "night" }),
      // Engine options; the D2 debug probe is off unless `?debug=1` asked.
      expect.objectContaining({ debug: false }),
    );
  });
});

describe("ReaderShell — cache-first book bytes (Stage 2 offline reading)", () => {
  it("a cache hit skips fetch entirely", async () => {
    const cached = new ArrayBuffer(4);
    bookStore.readCachedBook.mockImplementation(async () => cached);

    renderShell();
    await ready();

    expect(bookStore.readCachedBook).toHaveBeenCalledWith("book-1");
    expect(fetch).not.toHaveBeenCalled();
    expect(bookStore.writeCachedBook).not.toHaveBeenCalled();

    const { createReader } = await import("@/reader/engine");
    expect(createReader).toHaveBeenCalledWith(
      cached,
      expect.anything(),
      expect.anything(),
    );
  });

  it("a cache miss fetches over the network then populates the cache", async () => {
    // beforeEach's default is already a miss; assert the populate side too.
    renderShell();
    await ready();

    expect(bookStore.readCachedBook).toHaveBeenCalledWith("book-1");
    expect(fetch).toHaveBeenCalledWith("https://example.test/book.epub");
    await waitFor(() =>
      expect(bookStore.writeCachedBook).toHaveBeenCalledWith(
        "book-1",
        expect.any(ArrayBuffer),
        { title: "Frankenstein", author: "Mary Shelley" },
      ),
    );
  });

  it("shows the existing error state when there is neither cache nor network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) })),
    );

    renderShell();

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("Couldn't download the book (HTTP 500).");
    expect(bookStore.writeCachedBook).not.toHaveBeenCalled();
  });
});

describe("ReaderShell — cached percent stays fresh (Stage 4 offline reading, part 2)", () => {
  it("debounces the cache-percent write instead of writing on every relocation", async () => {
    let emit: ((loc: unknown) => void) | undefined;
    h.onRelocated.mockImplementation((cb: (loc: unknown) => void) => {
      emit = cb;
      return () => {};
    });

    renderShell();
    await ready();
    bookStore.updateCachedBookProgress.mockClear();

    // Two relocations in quick succession — a fast page-turner — must
    // collapse into a single write of the LATEST percent, not one write per
    // page turn.
    await act(async () => {
      emit?.({ cfi: "epubcfi(/6/8!/4/2)", percent: 0.1 });
    });
    await act(async () => {
      emit?.({ cfi: "epubcfi(/6/10!/4/2)", percent: 0.2 });
    });

    expect(bookStore.updateCachedBookProgress).not.toHaveBeenCalled();

    await waitFor(
      () =>
        expect(bookStore.updateCachedBookProgress).toHaveBeenCalledWith(
          "book-1",
          0.2,
        ),
      { timeout: 3000 },
    );
    expect(bookStore.updateCachedBookProgress).toHaveBeenCalledTimes(1);
  }, 8000);
});

describe("ReaderShell — asks the worker to cache its own document (defect: soft nav never cached)", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  it("messages the worker with this reader's path once the book is open, while online", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { controller: { postMessage } },
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });

    renderShell();
    await ready();

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({
        type: "leaf-offline/cache-reader",
        path: "/reader/book-1",
      }),
    );
  });

  it("does not message the worker while offline", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { controller: { postMessage } },
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });

    renderShell();
    await ready();

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does nothing (and does not throw) when there is no controller yet", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { controller: null },
    });

    // Reaching `ready()` at all is the assertion: a throw inside
    // `requestReaderCache` would have left the shell stuck in `loading`.
    renderShell();
    await ready();
  });
});

describe("ReaderShell — the offline cache is gated on ownership", () => {
  it("resolves the owner guard BEFORE reading the cached bytes", async () => {
    // The security fix: the boot guard mounts in the root layout, but React
    // commits a deeper page's effects before an ancestor layout's — so a hard
    // navigation straight to a bookmarked /reader/<id> can reach this effect
    // first. If the cache read were allowed to win that race, a device that
    // changed hands without an explicit sign-out would serve the previous
    // user's book bytes once, out of a cache that was about to be purged.
    const order: string[] = [];

    owner.enforceOfflineOwner.mockImplementationOnce(async () => {
      // Resolve on a later microtask, the way a real localStorage +
      // getSession read does. A marker pushed synchronously would appear
      // first whether or not the caller awaited, which would make this test
      // pass against the very race it exists to catch.
      await Promise.resolve();
      await Promise.resolve();
      order.push("guard");
    });
    bookStore.readCachedBook.mockImplementationOnce(async () => {
      order.push("read");
      return undefined;
    });

    renderShell();
    await ready();

    expect(order).toEqual(["guard", "read"]);
  });
});

describe("ReaderShell — cross-device sync offer (corrected: offered, never applied silently)", () => {
  it("surfaces an offer instead of navigating when the background reconcile finds a further position", async () => {
    let emit: ((offer: { cfi: string }) => void) | undefined;
    h.onSyncOffer.mockImplementation((cb: (offer: { cfi: string }) => void) => {
      emit = cb;
      return () => {};
    });
    h.chapterLabelForCfi.mockReturnValue("Chapter 12");

    renderShell();
    await ready();
    h.goTo.mockClear();

    act(() => {
      emit?.({ cfi: "server-cfi" });
    });

    expect(
      await screen.findByRole("button", { name: /^Continue from Chapter 12/i }),
    ).toBeTruthy();
    // Never a silent navigation for it.
    expect(h.goTo).not.toHaveBeenCalled();
  });

  it("does not render an offer when the background reconcile never calls back (server not further along)", async () => {
    renderShell();
    await ready();

    expect(
      screen.queryByRole("button", { name: /^Continue from/i }),
    ).toBeNull();
  });

  it("accepting the offer navigates, and leaves a working ReturnChip behind", async () => {
    let emit: ((offer: { cfi: string }) => void) | undefined;
    h.onSyncOffer.mockImplementation((cb: (offer: { cfi: string }) => void) => {
      emit = cb;
      return () => {};
    });
    h.chapterLabelForCfi.mockReturnValue("Chapter 12");
    h.currentChapterLabel.mockReturnValue("4");
    let relocate: ((loc: unknown) => void) | undefined;
    h.onRelocated.mockImplementation((cb: (loc: unknown) => void) => {
      relocate = cb;
      return () => {};
    });

    const user = userEvent.setup();
    renderShell();
    await ready();

    // The reader is somewhere before the offer ever shows up.
    await act(async () => {
      relocate?.({ cfi: "epubcfi(/6/8!/4/2)", percent: 0.34 });
    });

    act(() => {
      emit?.({ cfi: "server-cfi" });
    });
    const offerBtn = await screen.findByRole("button", {
      name: /^Continue from Chapter 12/i,
    });
    h.goTo.mockClear();
    await user.click(offerBtn);

    expect(h.goTo).toHaveBeenCalledWith("server-cfi");
    // The offer is gone, replaced by the way back to where accepting it
    // jumped FROM — accepting is itself a non-linear jump, undoable like any
    // other (reuses the same `jumpTo`/`returnTo` machinery as a TOC jump).
    expect(
      screen.queryByRole("button", { name: /^Continue from/i }),
    ).toBeNull();
    expect(
      await screen.findByRole("button", { name: "Return to Ch. 4" }),
    ).toBeTruthy();
  });

  it("dismissing the offer clears it without navigating or disturbing the position", async () => {
    let emit: ((offer: { cfi: string }) => void) | undefined;
    h.onSyncOffer.mockImplementation((cb: (offer: { cfi: string }) => void) => {
      emit = cb;
      return () => {};
    });
    h.chapterLabelForCfi.mockReturnValue("Chapter 12");

    const user = userEvent.setup();
    renderShell();
    await ready();
    h.goTo.mockClear();

    act(() => {
      emit?.({ cfi: "server-cfi" });
    });
    const dismissBtn = await screen.findByRole("button", {
      name: /Dismiss continue from Chapter 12 offer/i,
    });
    await user.click(dismissBtn);

    expect(
      screen.queryByRole("button", { name: /^Continue from/i }),
    ).toBeNull();
    expect(h.goTo).not.toHaveBeenCalled();
  });

  it("does not throw or update state if the offer arrives after the shell has torn down", async () => {
    let emit: ((offer: { cfi: string }) => void) | undefined;
    h.onSyncOffer.mockImplementation((cb: (offer: { cfi: string }) => void) => {
      emit = cb;
      return () => {};
    });

    const { unmount } = renderShell();
    await ready();
    unmount();

    expect(() => emit?.({ cfi: "server-cfi" })).not.toThrow();
  });
});
