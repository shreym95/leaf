import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Annotation } from "@/lib/types";
import { ReaderShell } from "./ReaderShell";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { useReaderSettings, READER_SETTINGS_DEFAULTS } from "@/store/reader-settings";

// One bar at a time in the top bar's slot when a highlight is tapped. The
// engine is a mock that hands its callbacks back to the test, so each engine
// event can be fired on demand (same setup as ReaderShell.bar.test.tsx).
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

// The highlight covers words 0–8 of the paragraph. The inside selection sits
// within it; the outside selection starts past its end.
const CFI_RANGE = "epubcfi(/6/4[chap01ref]!/4/2,/1:0,/1:8)";
const CFI_INSIDE = "epubcfi(/6/4[chap01ref]!/4/2,/1:2,/1:5)";
const CFI_OUTSIDE = "epubcfi(/6/4[chap01ref]!/4/2,/1:20,/1:25)";

function range(over: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1",
    user_id: "user-1",
    book_id: "book-1",
    kind: "range",
    cfi: CFI_RANGE,
    quote: "the sea",
    note: null,
    label: "Chapter One",
    percent: 0.25,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  } as Annotation;
}

const INITIAL = {
  fontFamily: "serif" as const,
  fontSize: 1.06,
  lineSpacing: 1.62,
  margins: "normal" as const,
  theme: "night" as const,
};

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

beforeEach(() => {
  vi.clearAllMocks();
  h.clicks.clear();
  h.selectionCb = undefined;
  h.clearedCb = undefined;
  h.tapCb = undefined;
  h.addHighlight.mockImplementation((_cfi: string, opts: { id: string; onClick?: () => void }) => {
    if (opts.onClick) h.clicks.set(opts.id, opts.onClick);
  });
  h.listAnnotations.mockImplementation(async () => [range()]);
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

function settle(cfiRange: string, text = "the sea") {
  act(() => h.selectionCb?.({ cfiRange, text }));
}

/** Waits for the painted highlight, then taps it the way the engine does. */
async function tapHighlight() {
  await waitFor(() => expect(h.clicks.has("a1")).toBe(true));
  act(() => h.clicks.get("a1")?.());
}

describe("ReaderShell — a highlight tap shows one bar", () => {
  it("a selection inside the tapped highlight within 1 s is the tap's own: only the highlight bar stays", async () => {
    renderShell();
    await ready();
    await tapHighlight();
    settle(CFI_INSIDE);
    expect(bar("Selected text actions")).toBeNull();
    expect(bar("Highlight actions")).not.toBeNull();
    expect(h.clearSelection).toHaveBeenCalled();
  });

  it("a selection outside the tapped highlight shows the selection bar, and its ✕ leaves no stale highlight bar", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();
    await tapHighlight();
    settle(CFI_OUTSIDE);
    expect(bar("Highlight actions")).toBeNull();
    expect(bar("Selected text actions")).not.toBeNull();
    await user.click(
      within(bar("Selected text actions")!).getByRole("button", { name: "Clear selection" }),
    );
    expect(bar("Selected text actions")).toBeNull();
    expect(bar("Highlight actions")).toBeNull();
  });

  it("a selection inside the highlight after 1 s (a deliberate long-press) replaces the highlight bar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderShell();
      await ready();
      await tapHighlight();
      act(() => {
        vi.advanceTimersByTime(1100);
      });
      settle(CFI_INSIDE);
      expect(bar("Highlight actions")).toBeNull();
      expect(bar("Selected text actions")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opening a highlight bar while a selection exists clears the selection and drops its bar", async () => {
    renderShell();
    await ready();
    settle(CFI_OUTSIDE);
    expect(bar("Selected text actions")).not.toBeNull();
    await tapHighlight();
    expect(h.clearSelection).toHaveBeenCalled();
    expect(bar("Selected text actions")).toBeNull();
    expect(bar("Highlight actions")).not.toBeNull();
  });
});
