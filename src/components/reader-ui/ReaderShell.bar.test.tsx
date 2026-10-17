import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Annotation } from "@/lib/types";
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

const CFI_RANGE = "epubcfi(/6/4[chap01ref]!/4/2,/1:0,/1:8)";

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
  h.listAnnotations.mockImplementation(async () => []);
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
  // The restore settles on a later tick than the load: wait for it so the
  // manager reports ready before a test presses a bar action.
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

describe("ReaderShell — selection bar in the top bar slot", () => {
  it("shows the selection actions in the top bar when a selection settles", async () => {
    renderShell();
    await ready();
    expect(bar("Selected text actions")).toBeNull();
    settle();
    const toolbar = bar("Selected text actions");
    expect(toolbar).not.toBeNull();
    expect(within(toolbar!).getByRole("button", { name: "Highlight" })).toBeInTheDocument();
    expect(within(toolbar!).getByRole("button", { name: "Note" })).toBeInTheDocument();
  });

  it("does not move focus to the bar when the selection appears", async () => {
    renderShell();
    await ready();
    const before = document.activeElement;
    settle();
    expect(document.activeElement).toBe(before);
  });

  it("Highlight on pointer-down paints the range and clears the book's selection", async () => {
    renderShell();
    await ready();
    settle();
    fireEvent.pointerDown(
      within(bar("Selected text actions")!).getByRole("button", { name: "Highlight" }),
      { button: 0 },
    );
    // The finger lifts: the hold releases one frame later.
    fireEvent.pointerUp(window, { button: 0 });
    await waitFor(() =>
      expect(h.addHighlight).toHaveBeenCalledWith(
        CFI_RANGE,
        expect.objectContaining({ id: expect.any(String) }),
      ),
    );
    expect(h.clearSelection).toHaveBeenCalled();
    expect(h.enqueueCreate).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ kind: "range", cfi: CFI_RANGE, quote: "the sea" }),
    );
  });

  it("Note opens the note field, and Save writes the note", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();
    settle();
    fireEvent.pointerDown(
      within(bar("Selected text actions")!).getByRole("button", { name: "Note" }),
      { button: 0 },
    );
    // The finger lifts: the hold releases one frame later.
    fireEvent.pointerUp(window, { button: 0 });
    const field = await screen.findByRole("textbox", { name: "Note" });
    expect(field).toHaveFocus();
    await user.type(field, "remember this");
    expect(screen.getByText("13/500")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(h.enqueueNote).toHaveBeenCalledWith(
      "user-1",
      expect.any(String),
      "remember this",
    );
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();
    expect(bar("Selected text actions")).toBeNull();
  });

  it("✕ and Esc clear the selection without turning the page", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();
    settle();
    await user.click(within(bar("Selected text actions")!).getByRole("button", { name: "Clear selection" }));
    expect(h.clearSelection).toHaveBeenCalled();
    expect(h.next).not.toHaveBeenCalled();

    settle();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(bar("Selected text actions")).toBeNull();
    expect(h.prev).not.toHaveBeenCalled();
  });

  it("a settled selection stays in the bar through the collapse grace window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderShell();
      await ready();
      settle();
      act(() => h.clearedCb?.());
      expect(bar("Selected text actions")).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(bar("Selected text actions")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ReaderShell — tapped highlight opens its actions", () => {
  it("opens Add note and Remove when a painted highlight is tapped", async () => {
    h.listAnnotations.mockImplementation(async () => [range()]);
    renderShell();
    await ready();
    await waitFor(() => expect(h.clicks.has("a1")).toBe(true));
    act(() => h.clicks.get("a1")?.());
    const toolbar = bar("Highlight actions");
    expect(toolbar).not.toBeNull();
    expect(within(toolbar!).getByRole("button", { name: "Add note" })).toBeInTheDocument();
    expect(within(toolbar!).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("removes a highlight without a note at once", async () => {
    const user = userEvent.setup();
    h.listAnnotations.mockImplementation(async () => [range()]);
    renderShell();
    await ready();
    await waitFor(() => expect(h.clicks.has("a1")).toBe(true));
    act(() => h.clicks.get("a1")?.());
    await user.click(within(bar("Highlight actions")!).getByRole("button", { name: "Remove" }));
    expect(h.enqueueDelete).toHaveBeenCalledWith("user-1", "a1");
    expect(bar("Highlight actions")).toBeNull();
  });

  it("asks before removing a highlight that has a note, and Keep leaves it", async () => {
    const user = userEvent.setup();
    h.listAnnotations.mockImplementation(async () => [range({ note: "keep me" })]);
    renderShell();
    await ready();
    await waitFor(() => expect(h.clicks.has("a1")).toBe(true));
    act(() => h.clicks.get("a1")?.());
    const toolbar = bar("Highlight actions")!;
    await user.click(within(toolbar).getByRole("button", { name: "Remove" }));
    expect(within(toolbar).getByText("Remove note too?")).toBeInTheDocument();
    await user.click(within(toolbar).getByRole("button", { name: "Keep" }));
    expect(h.enqueueDelete).not.toHaveBeenCalled();
    expect(within(toolbar).getByRole("button", { name: "Edit note" })).toBeInTheDocument();
  });

  it("does not turn the page on the tap that opened it", async () => {
    h.listAnnotations.mockImplementation(async () => [range()]);
    renderShell();
    await ready();
    await waitFor(() => expect(h.clicks.has("a1")).toBe(true));
    act(() => h.clicks.get("a1")?.());
    act(() => h.tapCb?.({ xFraction: 0.8, selectionActive: false }));
    expect(h.next).not.toHaveBeenCalled();
  });
});

describe("ReaderShell — touch page turns", () => {
  it("turns forward on a right-hand tap and back on a left-hand tap", async () => {
    renderShell();
    await ready();
    act(() => h.tapCb?.({ xFraction: 0.8, selectionActive: false }));
    await waitFor(() => expect(h.next).toHaveBeenCalledTimes(1));
    act(() => h.tapCb?.({ xFraction: 0.2, selectionActive: false }));
    await waitFor(() => expect(h.prev).toHaveBeenCalledTimes(1));
  });

  it("a tap with a selection active only clears the selection", async () => {
    renderShell();
    await ready();
    settle();
    act(() => h.tapCb?.({ xFraction: 0.8, selectionActive: true }));
    expect(h.clearSelection).toHaveBeenCalled();
    expect(h.next).not.toHaveBeenCalled();
    expect(bar("Selected text actions")).toBeNull();
  });

  it("a tap within the grace of a collapse does not turn the page", async () => {
    renderShell();
    await ready();
    act(() => h.clearedCb?.());
    act(() => h.tapCb?.({ xFraction: 0.8, selectionActive: false }));
    expect(h.next).not.toHaveBeenCalled();
    expect(h.prev).not.toHaveBeenCalled();
  });

  it("fine pointers do not turn from the content tap (edge buttons keep that job)", async () => {
    setPointer(false);
    renderShell();
    await ready();
    act(() => h.tapCb?.({ xFraction: 0.8, selectionActive: false }));
    expect(h.next).not.toHaveBeenCalled();
  });

  it("a page turn clears the selection", async () => {
    renderShell();
    await ready();
    settle();
    act(() => h.tapCb?.({ xFraction: 0.8, selectionActive: false }));
    await waitFor(() => expect(h.next).toHaveBeenCalledTimes(1));
    expect(h.clearSelection).toHaveBeenCalled();
    expect(bar("Selected text actions")).toBeNull();
  });

  it("opening the deck hides the bar and drops the selection", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();
    settle();
    await user.click(screen.getByRole("button", { name: /open reading controls/i }));
    expect(bar("Selected text actions")).toBeNull();
    expect(h.clearSelection).toHaveBeenCalled();
  });
});
