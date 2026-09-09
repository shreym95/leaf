import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReaderShell } from "./ReaderShell";
import { ReaderDebugOverlay, formatDebugText } from "./ReaderDebugOverlay";
import { debugRequested } from "./debug-flag";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import type { ReaderDebugSnapshot } from "@/reader/engine";
import {
  useReaderSettings,
  READER_SETTINGS_DEFAULTS,
} from "@/store/reader-settings";

// Same shape as ReaderShell.test.tsx: the engine is mocked, because what is
// under test is the SHELL's gating of the debug readout, not epub.js.
const h = vi.hoisted(() => ({
  applySettings: vi.fn(),
  destroy: vi.fn(),
  relayout: vi.fn(),
  next: vi.fn(async () => {}),
  prev: vi.fn(async () => {}),
  attach: vi.fn(async () => {}),
  goTo: vi.fn(async () => {}),
  onRelocated: vi.fn(() => () => {}),
  debugSnapshot: vi.fn(() => null),
  onDebug: vi.fn(() => () => {}),
  restore: vi.fn(async () => true),
  stop: vi.fn(),
}));

vi.mock("@/reader/engine", () => ({
  createReader: vi.fn(async () => ({
    attach: h.attach,
    next: h.next,
    prev: h.prev,
    goTo: h.goTo,
    relayout: h.relayout,
    applySettings: h.applySettings,
    onRelocated: h.onRelocated,
    debugSnapshot: h.debugSnapshot,
    onDebug: h.onDebug,
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

function renderShell(props: { debug?: boolean } = {}) {
  return render(
    <ThemeProvider>
      <ReaderShell
        bookId="book-1"
        title="The Hidden Oracle"
        author="Rick Riordan"
        fileUrl="https://example.test/book.epub"
        userId="user-1"
        initialSettings={INITIAL}
        {...props}
      />
    </ThemeProvider>,
  );
}

async function ready() {
  await waitFor(() => expect(h.attach).toHaveBeenCalled());
  await waitFor(() => expect(h.restore).toHaveBeenCalled());
}

const OVERLAY = /reader debug readout/i;

describe("debugRequested — the ?debug=1 gate", () => {
  it("is off unless the param is exactly '1'", () => {
    expect(debugRequested(undefined)).toBe(false);
    expect(debugRequested(null)).toBe(false);
    expect(debugRequested({})).toBe(false);
    // A bare `?debug`, a truthy-looking word, or an explicit off — all off. The
    // readout ships in production, so only the documented token opts in.
    expect(debugRequested({ debug: "" })).toBe(false);
    expect(debugRequested({ debug: "0" })).toBe(false);
    expect(debugRequested({ debug: "true" })).toBe(false);
    expect(debugRequested({ debug: "yes" })).toBe(false);
    expect(debugRequested({ debug: ["0", "2"] })).toBe(false);
    expect(debugRequested({ other: "1" })).toBe(false);
  });

  it("is on for ?debug=1", () => {
    expect(debugRequested({ debug: "1" })).toBe(true);
    // `?debug=0&debug=1` — repeated params arrive as an array.
    expect(debugRequested({ debug: ["0", "1"] })).toBe(true);
  });
});

describe("ReaderShell — the debug readout is opt-in only", () => {
  it("renders no readout for a normal reader, and never builds the probe", async () => {
    const { createReader } = await import("@/reader/engine");
    renderShell();
    await ready();

    expect(screen.queryByRole("region", { name: OVERLAY })).toBeNull();
    expect(screen.queryByRole("button", { name: /reader debug readout/i })).toBeNull();
    // The engine must not be asked for instrumentation either — an unasked-for
    // reader pays nothing for this build.
    expect(createReader).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ debug: false }),
    );
  });

  it("renders the readout and arms the probe when debug is requested", async () => {
    const { createReader } = await import("@/reader/engine");
    renderShell({ debug: true });
    await ready();

    expect(await screen.findByRole("region", { name: OVERLAY })).toBeInTheDocument();
    expect(createReader).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ debug: true }),
    );
  });
});

// --- the readout itself --------------------------------------------------

const SNAP: ReaderDebugSnapshot = {
  atMs: 1000,
  section: 14,
  href: "text/part0013.html",
  page: 7,
  total: 8,
  cfi: "epubcfi(/6/30!/4/2/2)",
  spread: "none",
  container: {
    scrollLeft: 2478,
    offsetWidth: 413,
    scrollWidth: 3304,
    clientWidth: 413,
    offsetHeight: 736,
  },
  layout: {
    delta: 413,
    pageWidth: 413,
    columnWidth: 413,
    gap: 0,
    height: 736,
    width: 413,
    divisor: 1,
  },
  measuredBox: { width: 412.57, height: 736 },
  view: {
    iframeWidth: 413,
    iframeHeight: 736,
    elementWidth: 413,
    reportedWidth: 3304,
    bodyScrollWidth: 3304,
  },
  advanceLeft: 3304,
  canAdvance: false,
  images: {
    total: 1,
    complete: 1,
    loadedAfterLayout: 1,
    lastLateMs: 412,
    scrollWidthAtLayout: 2891,
    scrollWidthAfterImages: 3304,
  },
  turns: [
    {
      n: 2,
      source: "tap-next",
      dir: "next",
      before: {
        section: 14,
        page: 7,
        total: 8,
        scrollLeft: 2478,
        offsetWidth: 413,
        scrollWidth: 3304,
        delta: 413,
        canAdvance: false,
      },
      after: { section: 15, page: 1, total: 6 },
      skipped: true,
    },
  ],
};

describe("ReaderDebugOverlay", () => {
  it("shows the live numbers and flags a skipped turn", () => {
    render(<ReaderDebugOverlay snapshot={() => SNAP} subscribe={() => () => {}} />);

    expect(screen.getByText(/text\/part0013\.html/)).toBeInTheDocument();
    // page / total, the advance test's verdict, and the late-image evidence.
    expect(screen.getByText(/7 \/ 8/)).toBeInTheDocument();
    expect(screen.getByText(/NEXT SECTION/)).toBeInTheDocument();
    expect(screen.getByText(/1 late \(\+412ms\)/)).toBeInTheDocument();
    expect(screen.getByText(/SKIPPED/)).toBeInTheDocument();
  });

  it("copies the whole state and log as text", async () => {
    // `userEvent.setup()` installs its own clipboard stub, so ours goes in
    // after it or it gets replaced.
    const user = userEvent.setup();
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<ReaderDebugOverlay snapshot={() => SNAP} subscribe={() => () => {}} />);
    await user.click(screen.getByRole("button", { name: "copy" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0][0];
    for (const fragment of [
      "section   14",
      "scrollLeft 2478",
      "delta 413",
      "412.57 x 736",
      "loaded after layout",
      "SKIPPED",
    ]) {
      expect(text).toContain(fragment);
    }
  });

  it("hides behind a small toggle and comes back", async () => {
    const user = userEvent.setup();
    render(<ReaderDebugOverlay snapshot={() => SNAP} subscribe={() => () => {}} />);

    await user.click(screen.getByRole("button", { name: /hide reader debug readout/i }));
    expect(screen.queryByRole("region", { name: OVERLAY })).toBeNull();

    await user.click(screen.getByRole("button", { name: /show reader debug readout/i }));
    expect(screen.getByRole("region", { name: OVERLAY })).toBeInTheDocument();
  });

  it("says so rather than throwing before the engine attaches", () => {
    render(<ReaderDebugOverlay snapshot={() => null} subscribe={() => null} />);
    expect(screen.getByText(/waiting for the engine/i)).toBeInTheDocument();
    expect(formatDebugText(null, null)).toMatch(/not attached/i);
  });
});
