import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TocPopover } from "./TocPopover";

const ENTRIES = [
  { href: "front.html", label: "Introduction" },
  { href: "ch1.html", label: "Chapter 1" },
  { href: "ch2.html", label: "Chapter 2" },
];

function renderPopover(over: Partial<Parameters<typeof TocPopover>[0]> = {}) {
  const onNavigate = vi.fn();
  render(
    <TocPopover
      id="toc-1"
      open
      entries={ENTRIES}
      currentLabel="Chapter 1"
      onNavigate={onNavigate}
      bookmarks={[]}
      onGoToBookmark={() => {}}
      onRemoveBookmark={() => {}}
      {...over}
    />,
  );
  return { onNavigate };
}

describe("TocPopover", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <TocPopover
        id="toc-1"
        open={false}
        entries={ENTRIES}
        currentLabel={null}
        onNavigate={() => {}}
        bookmarks={[]}
        onGoToBookmark={() => {}}
        onRemoveBookmark={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every entry and marks the current chapter", () => {
    renderPopover();
    const panel = screen.getByRole("dialog", { name: "Table of contents" });
    for (const entry of ENTRIES) {
      expect(
        within(panel).getByRole("button", { name: entry.label }),
      ).toBeTruthy();
    }
    expect(
      within(panel).getByRole("button", { name: "Chapter 1" }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      within(panel).getByRole("button", { name: "Introduction" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("navigates on click", async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderPopover();
    await user.click(screen.getByRole("button", { name: "Chapter 2" }));
    expect(onNavigate).toHaveBeenCalledWith("ch2.html");
  });

  it("moves focus to the first chapter on open", () => {
    renderPopover();
    expect(screen.getByRole("button", { name: "Introduction" })).toHaveFocus();
  });

  it("offers Contents and Bookmarks as tabs, Contents first", () => {
    renderPopover();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Contents", "Bookmarks"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the bookmark list and navigates from it", async () => {
    const user = userEvent.setup();
    const onGoToBookmark = vi.fn();
    renderPopover({
      bookmarks: [
        { id: "bm1", cfi: "epubcfi(/6/4!/4/2)", label: "Chapter 2", percent: 0.5 },
      ],
      onGoToBookmark,
    });
    await user.click(screen.getByRole("tab", { name: "Bookmarks" }));
    // `^` so this does not also match "Remove bookmark Chapter 2".
    await user.click(screen.getByRole("button", { name: /^Chapter 2/ }));
    expect(onGoToBookmark).toHaveBeenCalledWith("epubcfi(/6/4!/4/2)");
  });

  it("says so when there are no bookmarks yet", async () => {
    const user = userEvent.setup();
    renderPopover({ bookmarks: [] });
    await user.click(screen.getByRole("tab", { name: "Bookmarks" }));
    expect(screen.getByText(/No bookmarks yet/i)).toBeTruthy();
  });

  it("handles an empty table of contents", () => {
    renderPopover({ entries: [] });
    expect(screen.getByText(/no chapter list/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
