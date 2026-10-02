// ReaderShell's wiring of the finished-book detector (`@/reader/completion`).
// The detector's own rules are pinned in completion.test.ts; this file is about
// WHEN the shell arms it and WHICH jumps it vouches for. It runs the REAL
// tracker against a fake engine whose `relocated` stream the test drives, and
// observes the outcome — whether `recordFinished` was called.
//
// jsdom cannot model real epub.js pagination or timing: these are wiring tests,
// not a claim that a real book's last page behaves as simulated here.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReaderShell } from "./ReaderShell";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import {
  useReaderSettings,
  READER_SETTINGS_DEFAULTS,
} from "@/store/reader-settings";

const h = vi.hoisted(() => ({
  attach: vi.fn(async () => {}),
  goTo: vi.fn(async (_t: string) => {}),
  toc: vi.fn(() => [] as { href: string; label: string }[]),
  currentChapterLabel: vi.fn((): string | undefined => undefined),
  chapterLabelForCfi: vi.fn((_cfi: string): string | undefined => undefined),
  onRelocated: vi.fn((_cb: (loc: unknown) => void) => () => {}),
  restore: vi.fn(async () => true),
  onSyncOffer: vi.fn((_cb: (offer: { cfi: string }) => void) => () => {}),
  recordFinished: vi.fn(async (_id: string) => {}),
}));

vi.mock("@/reader/engine", () => ({
  createReader: vi.fn(async () => ({
    attach: h.attach,
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    goTo: h.goTo,
    currentChapterLabel: h.currentChapterLabel,
    chapterLabelForCfi: h.chapterLabelForCfi,
    toc: h.toc,
    relayout: vi.fn(),
    applySettings: vi.fn(),
    onRelocated: h.onRelocated,
    sectionCount: 12,
    destroy: vi.fn(),
  })),
}));

vi.mock("@/reader/position", () => ({
  trackPosition: vi.fn(() => ({
    restore: h.restore,
    onSyncOffer: h.onSyncOffer,
    stop: vi.fn(),
  })),
}));

vi.mock("@/reader/book-status", () => ({
  recordFinished: h.recordFinished,
  recordUnread: vi.fn(async () => {}),
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

type Cause = "next" | "prev" | "jump" | "other";

let relocate: (loc: unknown) => void;
let offer: (o: { cfi: string }) => void;

/** One engine relocation. The CFI encodes the percent so chips can round-trip it. */
function at(cause: Cause, percent: number, atEnd = false) {
  return act(async () => {
    relocate({ cfi: `cfi@${percent}`, percent, cause, atEnd });
  });
}

function renderShell(props: { finished?: boolean } = {}) {
  return render(
    <ThemeProvider>
      <ReaderShell
        bookId="book-1"
        title="Frankenstein"
        author="Mary Shelley"
        fileUrl="https://example.test/book.epub"
        userId="user-1"
        initialSettings={INITIAL}
        {...props}
      />
    </ThemeProvider>,
  );
}

/** The shell is open and the tracker has been armed (arming happens just before `toc()` is read). */
async function opened() {
  await waitFor(() => expect(h.attach).toHaveBeenCalled());
  await waitFor(() => expect(h.toc).toHaveBeenCalled());
}

async function jumpFromContents(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("button", { name: /open reading controls/i }));
  await user.click(screen.getByRole("button", { name: "Table of contents" }));
  await user.click(screen.getByRole("button", { name: label }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.toc.mockReturnValue([
    { href: "ch2.html", label: "Chapter 2" },
    { href: "ch9.html", label: "Chapter 9" },
  ]);
  h.currentChapterLabel.mockReturnValue(undefined);
  h.chapterLabelForCfi.mockReturnValue(undefined);
  h.restore.mockResolvedValue(true);
  h.onRelocated.mockImplementation((cb: (loc: unknown) => void) => {
    relocate = cb;
    return () => {};
  });
  h.onSyncOffer.mockImplementation((cb: (o: { cfi: string }) => void) => {
    offer = cb;
    return () => {};
  });
  useReaderSettings.setState({ ...READER_SETTINGS_DEFAULTS });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
  );
});

describe("ReaderShell — finishing a book", () => {
  it("records the finish when the reader pages to the last page", async () => {
    h.restore.mockResolvedValue(false);
    renderShell();
    await opened();

    await at("next", 0.5);
    await at("next", 0.97);
    expect(h.recordFinished).not.toHaveBeenCalled();
    await at("next", 0.99, true);

    expect(h.recordFinished).toHaveBeenCalledTimes(1);
    expect(h.recordFinished).toHaveBeenCalledWith("book-1");
  });

  it("does not record it for a book already marked finished", async () => {
    h.restore.mockResolvedValue(false);
    renderShell({ finished: true });
    await opened();

    await at("next", 0.97);
    await at("next", 0.99, true);

    expect(h.recordFinished).not.toHaveBeenCalled();
  });

  it("ignores relocations that arrive before the restore has finished (the tracker is not yet armed)", async () => {
    let finishRestore: (restored: boolean) => void = () => {};
    h.restore.mockImplementation(
      () => new Promise<boolean>((resolve) => (finishRestore = resolve)),
    );
    renderShell();
    await waitFor(() => expect(h.restore).toHaveBeenCalled());

    // An end-of-book turn lands while restore is still deciding where to go.
    await at("next", 0.99, true);
    expect(h.recordFinished).not.toHaveBeenCalled();

    finishRestore(false);
    await opened();
    // ...and it is not remembered as having happened.
    await at("other", 0.99, true);
    expect(h.recordFinished).not.toHaveBeenCalled();
  });
});

describe("ReaderShell — arming after the restore", () => {
  it("vouches for the restore's landing: an estimate far from the armed percent is not a skip", async () => {
    // First open on a new device: nothing seen, so armed at 0, and the restore
    // lands on a position far from that.
    renderShell();
    await opened();

    await at("jump", 0.94); // the restore's landing relocation
    await at("next", 0.97);
    await at("next", 0.99, true);

    expect(h.recordFinished).toHaveBeenCalledTimes(1);
  });

  it("does not vouch for a landing when nothing was restored", async () => {
    h.restore.mockResolvedValue(false);
    renderShell();
    await opened();

    await at("jump", 0.94); // not a restore landing — a skip
    await at("next", 0.99, true);

    expect(h.recordFinished).not.toHaveBeenCalled();
  });
});

describe("ReaderShell — which jumps are vouched for", () => {
  it("a contents jump to the last chapter, then paging to the end, does NOT finish the book", async () => {
    h.restore.mockResolvedValue(false);
    const user = userEvent.setup();
    renderShell();
    await opened();
    await at("next", 0.3);

    await jumpFromContents(user, "Chapter 9");
    expect(h.goTo).toHaveBeenCalledWith("ch9.html");
    await at("jump", 0.93);
    await at("next", 0.99, true);

    expect(h.recordFinished).not.toHaveBeenCalled();
  });

  it("accepting a cross-device sync offer is vouched for: jump to 95% then paging to the end finishes", async () => {
    h.restore.mockResolvedValue(false);
    h.chapterLabelForCfi.mockReturnValue("Chapter 12");
    const user = userEvent.setup();
    renderShell();
    await opened();
    await at("next", 0.3);

    act(() => offer({ cfi: "server-cfi" }));
    await user.click(await screen.findByRole("button", { name: /^Continue at Chapter 12/i }));
    expect(h.goTo).toHaveBeenCalledWith("server-cfi");
    await at("jump", 0.95);
    await at("next", 0.99, true);

    expect(h.recordFinished).toHaveBeenCalledTimes(1);
  });

  it("taking the way back is vouched for: returning clears a skip even to a spot short of where it began", async () => {
    // furthest 0.30 -> contents jump to 0.34 (not a skip) -> contents jump to
    // 0.93 (a skip, from 0.30) -> the chip returns to 0.34, which is not within
    // the return margin of 0.30 and so only counts because the return is vouched
    // for.
    h.restore.mockResolvedValue(false);
    const user = userEvent.setup();
    renderShell();
    await opened();
    await at("next", 0.3);

    await jumpFromContents(user, "Chapter 2");
    await at("jump", 0.34);
    await jumpFromContents(user, "Chapter 9");
    await at("jump", 0.93);

    await user.click(await screen.findByRole("button", { name: /^Return to/ }));
    expect(h.goTo).toHaveBeenLastCalledWith("cfi@0.34");
    await at("jump", 0.34);

    await at("next", 0.6);
    await at("next", 0.99, true);

    expect(h.recordFinished).toHaveBeenCalledTimes(1);
  });
});
