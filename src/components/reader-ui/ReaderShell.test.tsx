import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
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
  currentChapterLabel: vi.fn(() => undefined),
  toc: vi.fn(() => [] as { href: string; label: string }[]),
  onRelocated: vi.fn(() => () => {}),
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

  it("drives the engine from the settings sheet, reached via the dock", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();

    // Open the dock, then its `⋯` settings pod → the shared settings sheet.
    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    await user.click(screen.getByRole("button", { name: "Reading settings" }));
    h.applySettings.mockClear();
    await user.click(screen.getByRole("radio", { name: "L" }));

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

  it("keeps the bookmark list reachable via the settings sheet's Notes row", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();

    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    await user.click(screen.getByRole("button", { name: "Reading settings" }));
    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByText(/Bookmarks \(/)).toBeTruthy();
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
