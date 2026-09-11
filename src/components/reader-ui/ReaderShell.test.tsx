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
  toc: vi.fn(() => [] as { href: string; label: string }[]),
  onRelocated: vi.fn((_cb: (loc: unknown) => void) => () => {}),
  restore: vi.fn(async () => true),
  stop: vi.fn(),
}));

vi.mock("@/reader/engine", () => ({
  createReader: vi.fn(async () => ({
    attach: h.attach,
    next: h.next,
    prev: h.prev,
    goTo: h.goTo,
    currentChapterLabel: h.currentChapterLabel,
    toc: h.toc,
    relayout: h.relayout,
    applySettings: h.applySettings,
    onRelocated: h.onRelocated,
    sectionCount: 12,
    destroy: h.destroy,
  })),
}));

vi.mock("@/reader/position", () => ({
  trackPosition: vi.fn(() => ({ restore: h.restore, stop: h.stop })),
}));

vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: false,
  createClient: () => {
    throw new Error("not configured");
  },
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
  useReaderSettings.setState({ ...READER_SETTINGS_DEFAULTS });
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
