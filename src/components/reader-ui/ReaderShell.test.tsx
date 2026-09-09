import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
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

  it("drives the engine from the settings sheet's size control", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();

    await user.click(screen.getByRole("button", { name: /reading settings|Aa/i }));
    h.applySettings.mockClear();
    await user.click(screen.getByRole("radio", { name: "L" }));

    await waitFor(() => {
      expect(h.applySettings).toHaveBeenCalled();
      const last = h.applySettings.mock.lastCall?.[0] as { fontSize: number };
      expect(last.fontSize).toBeGreaterThan(1.06);
    });
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
