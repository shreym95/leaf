import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReaderShell } from "./ReaderShell";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { useReaderSettings, READER_SETTINGS_DEFAULTS } from "@/store/reader-settings";

// A selection the shell cannot take into a note: too long to highlight, and a
// highlight the manager rejects. Engine and storage are mocks, as in the bar suite.
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
const TOO_LONG = "Selection too long to highlight.";
const FAILED = "Couldn't highlight. Try again.";

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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function bar(name: string) {
  return screen.queryByRole("toolbar", { name });
}

function settle(text: string) {
  act(() => h.selectionCb?.({ cfiRange: CFI_RANGE, text }));
}

describe("ReaderShell — a selection too long to highlight", () => {
  const LONG = "a".repeat(5001);

  it("keeps the bar and says so when Highlight is pressed on a selection over 5000 characters", async () => {
    renderShell();
    await ready();
    settle(LONG);
    const toolbar = bar("Selected text actions");
    fireEvent.pointerDown(
      within(toolbar!).getByRole("button", { name: "Highlight" }),
      { button: 0 },
    );
    expect(await screen.findByText(TOO_LONG)).toHaveAttribute("role", "status");
    expect(bar("Selected text actions")).not.toBeNull();
    expect(within(bar("Selected text actions")!).getByRole("button", { name: "Highlight" })).toBeEnabled();
    expect(within(bar("Selected text actions")!).getByRole("button", { name: "Clear selection" })).toBeEnabled();
    expect(h.clearSelection).not.toHaveBeenCalled();
    expect(h.addHighlight).not.toHaveBeenCalled();
    expect(h.enqueueCreate).not.toHaveBeenCalled();
  });

  it("uses the same path for Note: the bar stays and the message shows", async () => {
    renderShell();
    await ready();
    settle(LONG);
    fireEvent.pointerDown(
      within(bar("Selected text actions")!).getByRole("button", { name: "Note" }),
      { button: 0 },
    );
    expect(await screen.findByText(TOO_LONG)).toHaveAttribute("role", "status");
    expect(bar("Selected text actions")).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();
    expect(h.clearSelection).not.toHaveBeenCalled();
    expect(h.enqueueCreate).not.toHaveBeenCalled();
  });

  it("accepts a selection of exactly 5000 characters", async () => {
    renderShell();
    await ready();
    settle("a".repeat(5000));
    fireEvent.pointerDown(
      within(bar("Selected text actions")!).getByRole("button", { name: "Highlight" }),
      { button: 0 },
    );
    await waitFor(() => expect(h.enqueueCreate).toHaveBeenCalled());
    expect(screen.queryByText(TOO_LONG)).toBeNull();
  });
});

describe("ReaderShell — a highlight that is rejected", () => {
  it("shows the error in the bar instead of closing silently", async () => {
    renderShell();
    await ready();
    // An empty quote is rejected by the manager's validation.
    settle("");
    fireEvent.pointerDown(
      within(bar("Selected text actions")!).getByRole("button", { name: "Highlight" }),
      { button: 0 },
    );
    expect(await screen.findByText(FAILED)).toHaveAttribute("role", "status");
    expect(bar("Selected text actions")).toBeNull();
    expect(h.addHighlight).not.toHaveBeenCalled();
    expect(h.enqueueCreate).not.toHaveBeenCalled();
  });

  it("clears the error from the dismiss control", async () => {
    const user = userEvent.setup();
    renderShell();
    await ready();
    settle("");
    fireEvent.pointerDown(
      within(bar("Selected text actions")!).getByRole("button", { name: "Highlight" }),
      { button: 0 },
    );
    await screen.findByText(FAILED);
    await user.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
