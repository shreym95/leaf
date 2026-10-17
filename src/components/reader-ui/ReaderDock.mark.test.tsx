import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReaderDock, type ReaderDockProps } from "./ReaderDock";

function renderDock(over: Partial<ReaderDockProps> = {}) {
  render(
    <ReaderDock
      open
      onOpenChange={vi.fn()}
      percent={0.42}
      chapterLabel="Chapter 4"
      toc={[]}
      onNavigate={vi.fn()}
      onPrevPage={vi.fn()}
      onNextPage={vi.fn()}
      theme="night"
      onSetTheme={vi.fn()}
      fontSize={1.06}
      onSetFontSize={vi.fn()}
      bookmarked={false}
      canBookmark
      onToggleBookmark={vi.fn()}
      {...over}
    />,
  );
  return within(screen.getByRole("region", { name: "Reading controls" }));
}

describe("ReaderDock — page mark pod", () => {
  it("names the page-mark action Bookmark this page when the page is unmarked", () => {
    const deck = renderDock({ bookmarked: false });

    const pod = deck.getByRole("button", { name: "Bookmark this page" });
    expect(pod).toHaveAttribute("aria-pressed", "false");
  });

  it("names the toggle Remove bookmark from this page and reports it pressed when marked", () => {
    const deck = renderDock({ bookmarked: true });

    const pod = deck.getByRole("button", { name: "Remove bookmark from this page" });
    expect(pod).toHaveAttribute("aria-pressed", "true");
  });
});
