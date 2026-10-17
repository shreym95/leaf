import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Annotation } from "@/lib/types";
import { ReaderShell } from "./ReaderShell";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { useReaderSettings, READER_SETTINGS_DEFAULTS } from "@/store/reader-settings";

// The note card for a tapped highlight, as the shell wires it: it opens on the
// highlight tap, closes on ✕, Esc, a page tap or a page turn, and takes Edit in
// place. The engine is a mock that hands its callbacks back to the test.
const h = vi.hoisted(() => ({
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
    onSelection: vi.fn(() => () => {}),
    onSelectionCleared: vi.fn(() => () => {}),
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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function bar(name: string) {
  return screen.queryByRole("toolbar", { name });
}

function card() {
  return screen.queryByRole("region", { name: "Note" });
}

/** Taps a painted highlight, then lets the tap guard lapse before the next tap. */
async function tapHighlight(id = "a1") {
  await waitFor(() => expect(h.clicks.has(id)).toBe(true));
  act(() => h.clicks.get(id)?.());
}

/** A page tap on the coarse pointer's right-hand side (a forward turn). */
function pageTap() {
  act(() => h.tapCb?.({ xFraction: 0.8, selectionActive: false }));
}

describe("ReaderShell — note card for a tapped highlight", () => {
  it("shows the full note in a card under the bar, and the slim bar shows only Note", async () => {
    const long = "Compare with the opening chapter, where the sea first appears. ".repeat(4).trim();
    h.listAnnotations.mockImplementation(async () => [range({ note: long })]);
    renderShell();
    await ready();
    await tapHighlight();
    const toolbar = bar("Highlight actions")!;
    expect(within(toolbar).getByText("Note")).toBeInTheDocument();
    expect(within(toolbar).queryByText(long)).toBeNull();
    expect(within(card()!).getByText(long)).toBeInTheDocument();
    expect(within(card()!).getByRole("button", { name: "Edit note" })).toBeInTheDocument();
    expect(within(card()!).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("shows no card for a highlight without a note", async () => {
    h.listAnnotations.mockImplementation(async () => [range()]);
    renderShell();
    await ready();
    await tapHighlight();
    expect(bar("Highlight actions")).not.toBeNull();
    expect(card()).toBeNull();
  });

  it("does not close the card on the tap that opened it", async () => {
    h.listAnnotations.mockImplementation(async () => [range({ note: "keep me" })]);
    renderShell();
    await ready();
    await tapHighlight();
    pageTap();
    expect(card()).not.toBeNull();
    expect(h.next).not.toHaveBeenCalled();
  });

  it("a page tap closes the card without turning the page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      h.listAnnotations.mockImplementation(async () => [range({ note: "keep me" })]);
      renderShell();
      await ready();
      await tapHighlight();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      pageTap();
      expect(card()).toBeNull();
      expect(bar("Highlight actions")).toBeNull();
      expect(h.next).not.toHaveBeenCalled();
      expect(h.prev).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("✕ closes the card and the bar", async () => {
    h.listAnnotations.mockImplementation(async () => [range({ note: "keep me" })]);
    renderShell();
    await ready();
    await tapHighlight();
    const user = userEvent.setup();
    await user.click(within(bar("Highlight actions")!).getByRole("button", { name: "Close highlight actions" }));
    expect(card()).toBeNull();
    expect(bar("Highlight actions")).toBeNull();
  });

  it("Esc closes the card", async () => {
    h.listAnnotations.mockImplementation(async () => [range({ note: "keep me" })]);
    renderShell();
    await ready();
    await tapHighlight();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(card()).toBeNull();
  });

  it("a page turn closes the card", async () => {
    h.listAnnotations.mockImplementation(async () => [range({ note: "keep me" })]);
    renderShell();
    await ready();
    await tapHighlight();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(h.next).toHaveBeenCalled();
    expect(card()).toBeNull();
  });

  it("Edit note swaps the card to the editor, and Save returns to the card with the new text", async () => {
    const user = userEvent.setup();
    h.listAnnotations.mockImplementation(async () => [range({ note: "first" })]);
    renderShell();
    await ready();
    await tapHighlight();
    await user.click(within(card()!).getByRole("button", { name: "Edit note" }));
    const field = within(card()!).getByRole("textbox", { name: "Note" });
    expect(field).toHaveValue("first");
    await user.clear(field);
    await user.type(field, "second");
    await user.click(within(card()!).getByRole("button", { name: "Save" }));
    expect(h.enqueueNote).toHaveBeenCalledWith("user-1", expect.any(String), "second");
    expect(card()).not.toBeNull();
    expect(within(card()!).getByText("second")).toBeInTheDocument();
    expect(within(card()!).getByRole("button", { name: "Edit note" })).toBeInTheDocument();
    expect(within(card()!).queryByRole("textbox")).toBeNull();
  });

  it("Add note on a highlight without a note opens the card editor, empty and focused", async () => {
    const user = userEvent.setup();
    h.listAnnotations.mockImplementation(async () => [range()]);
    renderShell();
    await ready();
    await tapHighlight();
    expect(card()).toBeNull();
    await user.click(within(bar("Highlight actions")!).getByRole("button", { name: "Add note" }));
    const field = within(card()!).getByRole("textbox", { name: "Note" });
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(bar("Highlight actions")).not.toBeNull();
    await user.type(field, "a fresh thought");
    await user.click(within(card()!).getByRole("button", { name: "Save" }));
    expect(h.enqueueNote).toHaveBeenCalledWith("user-1", "a1", "a fresh thought");
    expect(within(card()!).getByText("a fresh thought")).toBeInTheDocument();
    expect(within(card()!).queryByRole("textbox")).toBeNull();
  });

  it("Cancel and Esc leave the note as it was and do not write", async () => {
    const user = userEvent.setup();
    h.listAnnotations.mockImplementation(async () => [range({ note: "first" })]);
    renderShell();
    await ready();
    await tapHighlight();
    await user.click(within(card()!).getByRole("button", { name: "Edit note" }));
    await user.type(within(card()!).getByRole("textbox", { name: "Note" }), " draft");
    await user.click(within(card()!).getByRole("button", { name: "Cancel" }));
    expect(within(card()!).getByText("first")).toBeInTheDocument();
    await user.click(within(card()!).getByRole("button", { name: "Edit note" }));
    fireEvent.keyDown(within(card()!).getByRole("textbox", { name: "Note" }), { key: "Escape" });
    expect(within(card()!).queryByRole("textbox")).toBeNull();
    expect(card()).not.toBeNull();
    expect(h.enqueueNote).not.toHaveBeenCalled();
  });

  it("the counter reads n/500 and Save is disabled over 500 characters", async () => {
    const user = userEvent.setup();
    h.listAnnotations.mockImplementation(async () => [range({ note: "first" })]);
    renderShell();
    await ready();
    await tapHighlight();
    await user.click(within(card()!).getByRole("button", { name: "Edit note" }));
    const field = within(card()!).getByRole("textbox", { name: "Note" });
    expect(within(card()!).getByText("5/500")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "n".repeat(501) } });
    expect(within(card()!).getByText("501/500")).toBeInTheDocument();
    expect(within(card()!).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a page tap with unsaved text keeps the editor open and turns nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      h.listAnnotations.mockImplementation(async () => [range({ note: "keep me" })]);
      renderShell();
      await ready();
      await tapHighlight();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      await user.click(within(card()!).getByRole("button", { name: "Edit note" }));
      await user.type(within(card()!).getByRole("textbox", { name: "Note" }), " and more");
      pageTap();
      expect(within(card()!).getByRole("textbox", { name: "Note" })).toHaveValue("keep me and more");
      expect(bar("Highlight actions")).not.toBeNull();
      expect(h.next).not.toHaveBeenCalled();
      expect(h.prev).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a page tap closes a clean editor, without turning the page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      h.listAnnotations.mockImplementation(async () => [range({ note: "keep me" })]);
      renderShell();
      await ready();
      await tapHighlight();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      await user.click(within(card()!).getByRole("button", { name: "Edit note" }));
      pageTap();
      expect(card()).toBeNull();
      expect(bar("Highlight actions")).toBeNull();
      expect(h.next).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
