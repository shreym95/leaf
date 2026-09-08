import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotesPanel, type BookmarkItem } from "./NotesPanel";

// The bookmark surface is a placeholder (see the NotesPanel file header). These
// tests pin its behaviour, not its look — the schema and data layer under it
// are the stable part.

function setup(over: Partial<React.ComponentProps<typeof NotesPanel>> = {}) {
  const props: React.ComponentProps<typeof NotesPanel> = {
    open: true,
    onOpenChange: vi.fn(),
    items: [],
    onGoTo: vi.fn(),
    onSetNote: vi.fn(),
    onRemove: vi.fn(),
    bookmarks: [],
    canBookmark: true,
    currentPageBookmarked: false,
    onToggleBookmark: vi.fn(),
    onGoToBookmark: vi.fn(),
    onRemoveBookmark: vi.fn(),
    ...over,
  };
  render(<NotesPanel {...props} />);
  return props;
}

const BM = (over: Partial<BookmarkItem> = {}): BookmarkItem => ({
  id: "bm-1",
  cfi: "epubcfi(/6/14!/4/2/1:0)",
  label: "Chapter 3",
  percent: 0.42,
  ...over,
});

describe("bookmark toggle", () => {
  it('offers to bookmark the page, and calls back on click', async () => {
    const user = userEvent.setup();
    const props = setup({ currentPageBookmarked: false });

    const btn = screen.getByRole("button", { name: "Bookmark this page" });
    await user.click(btn);
    expect(props.onToggleBookmark).toHaveBeenCalledTimes(1);
  });

  it("switches to a remove affordance when the page is already bookmarked", () => {
    setup({ currentPageBookmarked: true });
    const btn = screen.getByRole("button", { name: "Remove bookmark" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("is disabled before the reader has reported a position", () => {
    setup({ canBookmark: false });
    expect(
      screen.getByRole("button", { name: "Bookmark this page" }),
    ).toBeDisabled();
  });
});

describe("bookmark list", () => {
  it("renders each saved bookmark with its chapter label and percent", () => {
    setup({ bookmarks: [BM(), BM({ id: "bm-2", label: null, percent: null })] });

    expect(screen.getByText("Chapter 3")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    // A bookmark with no denormalised label still renders.
    expect(screen.getByText("Bookmarked page")).toBeInTheDocument();
  });

  it("navigates to a bookmark's CFI when its row is clicked", async () => {
    const user = userEvent.setup();
    const props = setup({ bookmarks: [BM()] });

    await user.click(screen.getByRole("button", { name: /^Chapter 3/ }));
    expect(props.onGoToBookmark).toHaveBeenCalledWith("epubcfi(/6/14!/4/2/1:0)");
  });

  it("removes a bookmark via its labelled delete control", async () => {
    const user = userEvent.setup();
    const props = setup({ bookmarks: [BM()] });

    await user.click(
      screen.getByRole("button", { name: "Delete bookmark — Chapter 3" }),
    );
    expect(props.onRemoveBookmark).toHaveBeenCalledWith("bm-1");
  });

  it("shows an empty-state hint when there are no bookmarks", () => {
    setup({ bookmarks: [] });
    expect(
      screen.getByText(/Bookmark the page you are on/i),
    ).toBeInTheDocument();
  });
});
