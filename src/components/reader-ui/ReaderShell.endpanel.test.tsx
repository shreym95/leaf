// ReaderShell's wiring of the end-of-book panel. Same harness as
// ReaderShell.completion.test.tsx: the REAL completion tracker against a fake
// engine whose `relocated` stream the test drives. jsdom cannot model real
// epub.js pagination, so this proves the gate and the state, not the visuals.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReaderShell } from "./ReaderShell";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import {
  useReaderSettings,
  READER_SETTINGS_DEFAULTS,
} from "@/store/reader-settings";

const h = vi.hoisted(() => ({
  attach: vi.fn(async () => {}),
  next: vi.fn(async () => {}),
  prev: vi.fn(async () => {}),
  goTo: vi.fn(async (_t: string) => {}),
  toc: vi.fn(() => [] as { href: string; label: string }[]),
  onRelocated: vi.fn((_cb: (loc: unknown) => void) => () => {}),
  restore: vi.fn(async () => false),
  recordFinished: vi.fn(async (_id: string) => {}),
  recordUnread: vi.fn(async (_id: string) => {}),
}));

vi.mock("@/reader/engine", () => ({
  createReader: vi.fn(async () => ({
    attach: h.attach,
    next: h.next,
    prev: h.prev,
    goTo: h.goTo,
    currentChapterLabel: vi.fn(() => undefined),
    chapterLabelForCfi: vi.fn(() => undefined),
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
    onSyncOffer: vi.fn(() => () => {}),
    stop: vi.fn(),
  })),
}));

vi.mock("@/reader/book-status", () => ({
  recordFinished: h.recordFinished,
  recordUnread: h.recordUnread,
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

async function opened() {
  await waitFor(() => expect(h.attach).toHaveBeenCalled());
  await waitFor(() => expect(h.toc).toHaveBeenCalled());
}

const PANEL = { name: "End of book" };
const panel = () => screen.queryByRole("region", PANEL);

/** Every next-intent the shell exposes. */
const nextTap = () => fireEvent.click(screen.getByRole("button", { name: "Next page" }));
const prevTap = () => fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
const nextKey = () => fireEvent.keyDown(window, { key: "ArrowRight" });
const prevKey = () => fireEvent.keyDown(window, { key: "ArrowLeft" });
// The dock has its own "Next page" button; the tap zone's is the one with
// tabindex -1.
const nextDock = () => {
  const dock = screen
    .getAllByRole("button", { name: "Next page", hidden: true })
    .find((el) => el.getAttribute("tabindex") !== "-1");
  if (!dock) throw new Error("dock next button not found");
  fireEvent.click(dock);
};

beforeEach(() => {
  vi.clearAllMocks();
  h.toc.mockReturnValue([{ href: "ch2.html", label: "Chapter 2" }]);
  h.restore.mockResolvedValue(false);
  h.onRelocated.mockImplementation((cb: (loc: unknown) => void) => {
    relocate = cb;
    return () => {};
  });
  useReaderSettings.setState({ ...READER_SETTINGS_DEFAULTS });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
  );
});

describe("end-of-book panel — the trigger", () => {
  it("reaching the last page shows nothing", async () => {
    renderShell();
    await opened();
    await at("next", 0.5);
    await at("next", 0.99, true);
    expect(panel()).toBeNull();
  });

  it("next while at the end opens the panel and does not call controller.next", async () => {
    renderShell();
    await opened();
    await at("next", 0.99, true);

    nextTap();

    expect(await screen.findByRole("region", PANEL)).toBeTruthy();
    expect(h.next).not.toHaveBeenCalled();
  });

  it.each([
    ["the tap zone", nextTap],
    ["the → key", nextKey],
    ["the dock button", nextDock],
  ])("opens from %s", async (_name, press) => {
    renderShell();
    await opened();
    await at("next", 0.99, true);

    press();

    expect(await screen.findByRole("region", PANEL)).toBeTruthy();
    expect(h.next).not.toHaveBeenCalled();
  });

  it("next while not at the end turns the page, with no panel", async () => {
    renderShell();
    await opened();
    await at("next", 0.5, false);

    nextTap();

    expect(h.next).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
  });

  it("uses the LATEST relocation: paging back off the last page re-enables turning", async () => {
    renderShell();
    await opened();
    await at("next", 0.99, true);
    await at("prev", 0.97, false);

    nextKey();

    expect(h.next).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
  });

  it("a further next while the panel is open does nothing", async () => {
    renderShell();
    await opened();
    await at("next", 0.99, true);
    nextKey();
    await screen.findByRole("region", PANEL);

    nextKey();
    nextDock();

    expect(h.next).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
  });
});

describe("end-of-book panel — closing", () => {
  async function openPanel() {
    renderShell();
    await opened();
    await at("next", 0.99, true);
    nextKey();
    await screen.findByRole("region", PANEL);
  }

  it.each([
    ["the ← key", prevKey],
    ["the previous tap zone", prevTap],
  ])("%s closes it and stays on the last page", async (_name, press) => {
    await openPanel();

    press();

    await waitFor(() => expect(panel()).toBeNull());
    expect(h.prev).not.toHaveBeenCalled();
    expect(h.next).not.toHaveBeenCalled();
  });

  it("Escape closes it", async () => {
    await openPanel();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(panel()).toBeNull());
    expect(h.prev).not.toHaveBeenCalled();
  });

  it("Back to the last page closes it, returns focus to the frame, and next reopens it", async () => {
    const user = userEvent.setup();
    await openPanel();

    await user.click(screen.getByRole("button", { name: "Back to the last page" }));

    await waitFor(() => expect(panel()).toBeNull());
    expect(document.activeElement).toBe(
      screen.getByRole("main", { name: "Reader" }).firstElementChild,
    );
    nextKey();
    expect(await screen.findByRole("region", PANEL)).toBeTruthy();
    expect(h.next).not.toHaveBeenCalled();
  });

  it("moves focus to the heading when it opens", async () => {
    await openPanel();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Frankenstein" }),
    );
  });

  it("closes without stealing focus if the reader navigates away from the last page", async () => {
    await openPanel();
    await at("jump", 0.4, false);
    await waitFor(() => expect(panel()).toBeNull());
  });
});

describe("end-of-book panel — content and state", () => {
  it("a book already finished opens on the finished state", async () => {
    renderShell({ finished: true });
    await opened();
    await at("next", 0.99, true);
    nextKey();

    await screen.findByRole("region", PANEL);
    expect(screen.getByText("Finished")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark as unread" })).toBeTruthy();
    // No date is known for a finish made in an earlier session.
    expect(document.querySelector("time")).toBeNull();
  });

  it("a book that finished this session shows finished, with today's date", async () => {
    renderShell();
    await opened();
    await at("next", 0.5);
    await at("next", 0.99, true);
    expect(h.recordFinished).toHaveBeenCalledTimes(1);
    nextKey();

    await screen.findByRole("region", PANEL);
    expect(screen.getByText("Finished")).toBeTruthy();
    expect(document.querySelector("time")).not.toBeNull();
  });

  it("an unfinished book (the rule did not fire) shows 'The end' and Mark as finished", async () => {
    renderShell();
    await opened();
    // Arrived by a jump, never by paging: the conservative rule does not fire.
    await at("jump", 0.99, true);
    nextKey();

    await screen.findByRole("region", PANEL);
    expect(h.recordFinished).not.toHaveBeenCalled();
    expect(screen.getByText("The end")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark as finished" })).toBeTruthy();
  });

  it("Mark as unread calls recordUnread, flips to not-finished, and the tracker does not re-fire", async () => {
    const user = userEvent.setup();
    renderShell();
    await opened();
    await at("next", 0.5);
    await at("next", 0.99, true);
    expect(h.recordFinished).toHaveBeenCalledTimes(1);
    nextKey();
    await screen.findByRole("region", PANEL);

    await user.click(screen.getByRole("button", { name: "Mark as unread" }));

    expect(h.recordUnread).toHaveBeenCalledWith("book-1");
    expect(screen.getByText("The end")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark as finished" })).toBeTruthy();

    // Back off the page and onto it again by turning: must not re-finish.
    await user.click(screen.getByRole("button", { name: "Back to the last page" }));
    await at("prev", 0.97, false);
    await at("next", 0.99, true);
    expect(h.recordFinished).toHaveBeenCalledTimes(1);
  });

  it("a hand-marked unread is not overruled by the detector, even if it had not fired yet", async () => {
    const user = userEvent.setup();
    // A restored landing is vouched for, so the rule is still able to fire later.
    h.restore.mockResolvedValue(true);
    renderShell();
    await opened();
    await at("jump", 0.95, true); // the restore's landing, on the last page
    nextKey();
    await screen.findByRole("region", PANEL);
    expect(h.recordFinished).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Mark as finished" }));
    await user.click(screen.getByRole("button", { name: "Mark as unread" }));
    await user.click(screen.getByRole("button", { name: "Back to the last page" }));
    h.recordFinished.mockClear();

    // The reader pages back and reaches the end again by turning pages — the
    // rule would fire here, were it not for the reader's explicit choice.
    await at("prev", 0.94, false);
    await at("next", 0.99, true);

    expect(h.recordFinished).not.toHaveBeenCalled();
  });

  it("Mark as finished calls recordFinished and flips to finished with a date", async () => {
    const user = userEvent.setup();
    renderShell();
    await opened();
    await at("jump", 0.99, true);
    nextKey();
    await screen.findByRole("region", PANEL);

    await user.click(screen.getByRole("button", { name: "Mark as finished" }));

    expect(h.recordFinished).toHaveBeenCalledWith("book-1");
    expect(screen.getByText("Finished")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark as unread" })).toBeTruthy();
    expect(document.querySelector("time")).not.toBeNull();
  });
});

// epub.js's `atEnd` can stay false on the true last page. The engine's own
// next() then reports that it could not move because the book is over, and the
// FIRST such tap must open the panel — not leave the reader tapping at nothing.
describe("end-of-book panel — a next the engine could not make", () => {
  const stalledAtEnd = () =>
    h.next.mockResolvedValueOnce({ moved: false, atEnd: true } as unknown as undefined);

  it("opens the panel on the first tap, though no relocation ever said atEnd", async () => {
    renderShell();
    await opened();
    await at("next", 0.99, false); // epub.js did not flag the last page
    stalledAtEnd();

    nextTap();

    expect(await screen.findByRole("region", PANEL)).toBeTruthy();
    expect(h.next).toHaveBeenCalledTimes(1);
  });

  it("stays open for the relocation that follows, and that relocation finishes the book", async () => {
    renderShell();
    await opened();
    await at("next", 0.97, false);
    stalledAtEnd();
    nextKey();
    await screen.findByRole("region", PANEL);

    await at("next", 0.97, true); // the engine's relocation for that turn

    expect(panel()).not.toBeNull();
    await waitFor(() => expect(h.recordFinished).toHaveBeenCalledWith("book-1"));
  });

  it("a next that moved opens nothing", async () => {
    renderShell();
    await opened();
    await at("next", 0.5, false);
    h.next.mockResolvedValueOnce({ moved: true, atEnd: false } as unknown as undefined);

    nextTap();

    await waitFor(() => expect(h.next).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(panel()).toBeNull();
  });

  it("a next that stalled mid-book opens nothing", async () => {
    renderShell();
    await opened();
    await at("next", 0.5, false);
    h.next.mockResolvedValueOnce({ moved: false, atEnd: false } as unknown as undefined);

    nextTap();

    await waitFor(() => expect(h.next).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(panel()).toBeNull();
  });
});
