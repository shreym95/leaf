import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReaderShell } from "./ReaderShell";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { useReaderSettings, READER_SETTINGS_DEFAULTS } from "@/store/reader-settings";

// The selection bar, the tapped-highlight sheet and the touch tap policy, as
// the shell wires them. The engine is a mock that hands its callbacks back to
// the test, so each engine event can be fired on demand.
const h = vi.hoisted(() => ({
  selectionCb: undefined as undefined | ((sel: { cfiRange: string; text: string }) => void),
  clearedCb: undefined as undefined | (() => void),
  tapCb: undefined as undefined | ((tap: { xFraction: number; selectionActive: boolean }) => void),
  clicks: new Map<string, () => void>(),
  addHighlight: vi.fn(),
  clearSelection: vi.fn(),
  next: vi.fn(async () => ({ atEnd: false })),
  prev: vi.fn(async () => {}),
  attach: vi.fn(async () => {}),
  restore: vi.fn(async () => true),
  listAnnotations: vi.fn(async (): Promise<unknown[]> => []),
  enqueueCreate: vi.fn(async () => {}),
  enqueueNote: vi.fn(async () => {}),
  enqueueDelete: vi.fn(async () => {}),
}));

vi.mock("@/reader/engine", () => ({
  createReader: vi.fn(async () => ({
    attach: h.attach,
    next: h.next,
    prev: h.prev,
    goTo: vi.fn(async () => {}),
    currentChapterLabel: vi.fn(() => "Chapter One"),
    chapterLabelForCfi: vi.fn(() => undefined),
    toc: vi.fn(() => []),
    relayout: vi.fn(),
    applySettings: vi.fn(),
    onRelocated: vi.fn(() => () => {}),
    onSelection: vi.fn((cb: (sel: { cfiRange: string; text: string }) => void) => {
      h.selectionCb = cb;
      return () => {};
    }),
    onSelectionCleared: vi.fn((cb: () => void) => {
      h.clearedCb = cb;
      return () => {};
    }),
    onContentTap: vi.fn((cb: (tap: { xFraction: number; selectionActive: boolean }) => void) => {
      h.tapCb = cb;
      return () => {};
    }),
    locateCfi: vi.fn(() => null),
    addHighlight: h.addHighlight,
    removeHighlight: vi.fn(),
    clearSelection: h.clearSelection,
    sectionCount: 12,
    destroy: vi.fn(),
  })),
}));

vi.mock("@/reader/position", () => ({
  trackPosition: vi.fn(() => ({
    restore: h.restore,
    onSyncOffer: vi.fn(() => () => {}),
    stop: vi.fn(),
  })),
}));

vi.mock("@/lib/db/annotations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/annotations")>()),
  listAnnotationsWithCache: h.listAnnotations,
}));

vi.mock("@/lib/offline/outbox", () => ({
  enqueueAnnotationCreate: h.enqueueCreate,
  enqueueAnnotationNote: h.enqueueNote,
  enqueueAnnotationDelete: h.enqueueDelete,
}));

vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: false,
  createClient: () => {
    throw new Error("not configured");
  },
}));

vi.mock("@/lib/offline/book-store", () => ({
  readCachedBook: vi.fn(async () => undefined),
  writeCachedBook: vi.fn(async () => {}),
  updateCachedBookProgress: vi.fn(async () => {}),
}));

vi.mock("@/lib/offline/owner", () => ({
  enforceOfflineOwner: vi.fn(async () => {}),
}));


const INITIAL = {
  fontFamily: "serif" as const,
  fontSize: 1.06,
  lineSpacing: 1.62,
  margins: "normal" as const,
  theme: "night" as const,
};

const CFI_RANGE = "epubcfi(/6/4[chap01ref]!/4/2,/1:0,/1:8)";

function setPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  });
}

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

/** Opens the book and waits until the annotations have restored (paints done). */
async function ready() {
  await waitFor(() => expect(h.attach).toHaveBeenCalled());
  await waitFor(() => expect(h.restore).toHaveBeenCalled());
  await waitFor(() => expect(h.listAnnotations).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function bar(name: string) {
  return screen.queryByRole("toolbar", { name });
}

function settle(text = "the sea") {
  act(() => h.selectionCb?.({ cfiRange: CFI_RANGE, text }));
}

function tapAt(xFraction: number) {
  act(() => h.tapCb?.({ xFraction, selectionActive: false }));
}

function topBar(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-reader-chrome]");
  if (!el) throw new Error("top bar is not rendered");
  return el;
}

function dock(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-reader-dock]");
  if (!el) throw new Error("dock is not rendered");
  return el;
}

/** True when neither bar is inert. */
function barsShown(): boolean {
  return !topBar().hasAttribute("inert") && !dock().hasAttribute("inert");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectionCb = undefined;
  h.clearedCb = undefined;
  h.tapCb = undefined;
  useReaderSettings.setState({ ...READER_SETTINGS_DEFAULTS });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
  );
  setPointer(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error — remove the stub so other suites see the jsdom default
  delete window.matchMedia;
});

describe("ReaderShell — touch bars (top bar and dock hide and show together)", () => {
  it("shows both bars when the book opens, floating over the page", async () => {
    renderShell();
    await ready();
    expect(barsShown()).toBe(true);
    expect(topBar()).toHaveClass("absolute");
    expect(dock()).toHaveClass("absolute");
  });

  it("hides both bars after a page tap turns forward", async () => {
    renderShell();
    await ready();
    tapAt(0.8);
    await waitFor(() => expect(h.next).toHaveBeenCalledTimes(1));
    expect(topBar()).toHaveAttribute("inert");
    expect(topBar()).toHaveAttribute("aria-hidden", "true");
    expect(dock()).toHaveAttribute("inert");
    expect(dock()).toHaveAttribute("aria-hidden", "true");
  });

  it("a middle tap toggles both bars without turning the page", async () => {
    renderShell();
    await ready();
    tapAt(0.45);
    expect(barsShown()).toBe(false);
    tapAt(0.45);
    expect(barsShown()).toBe(true);
    expect(h.next).not.toHaveBeenCalled();
    expect(h.prev).not.toHaveBeenCalled();
  });

  it("a dock turn made with the deck open keeps the bars where they are", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();
    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    const deck = screen.getByRole("region", { name: "Reading controls" });
    await user.click(within(deck).getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(h.next).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: /close reading controls/i }));
    expect(barsShown()).toBe(true);
  });

  it("the open deck keeps both bars shown, even after a middle tap has hidden them", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();
    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    tapAt(0.45);
    expect(barsShown()).toBe(true);
  });

  it("closing the deck returns focus to the dock, which shows the bars again", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();
    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    tapAt(0.45);
    await user.click(screen.getByRole("button", { name: /close reading controls/i }));
    expect(barsShown()).toBe(true);
  });

  it("the selection bar still shows in the top bar while the bars are hidden", async () => {
    renderShell();
    await ready();
    tapAt(0.8);
    await waitFor(() => expect(h.next).toHaveBeenCalledTimes(1));
    expect(topBar()).toHaveAttribute("inert");
    settle();
    expect(bar("Selected text actions")).not.toBeNull();
    expect(topBar()).not.toHaveAttribute("inert");
    expect(dock()).toHaveAttribute("inert");
  });

  it("focus moving into a hidden bar shows the bars again", async () => {
    renderShell();
    await ready();
    tapAt(0.8);
    await waitFor(() => expect(h.next).toHaveBeenCalledTimes(1));
    expect(barsShown()).toBe(false);
    act(() => dock().querySelector<HTMLElement>("button")?.focus());
    expect(barsShown()).toBe(true);
  });

  it("a fine pointer never hides or toggles the bars", async () => {
    setPointer(false);
    renderShell();
    await ready();
    tapAt(0.8);
    tapAt(0.45);
    expect(h.next).not.toHaveBeenCalled();
    expect(barsShown()).toBe(true);
    expect(topBar()).not.toHaveClass("absolute");
    expect(dock()).not.toHaveClass("absolute");
  });
});
