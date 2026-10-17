import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TocPopover } from "./TocPopover";

const ENTRIES = [{ href: "ch1.html", label: "Chapter 1" }];

function renderPopover(groupPanel?: ReactNode) {
  render(
    <TocPopover
      id="toc-1"
      open
      entries={ENTRIES}
      currentLabel={null}
      onNavigate={() => {}}
      bookmarks={[]}
      onGoToBookmark={() => {}}
      onRemoveBookmark={() => {}}
      groupPanel={groupPanel}
    />,
  );
}

describe("TocPopover Group tab", () => {
  it("has only Contents and Bookmarks when no group panel is passed", () => {
    renderPopover();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Contents", "Bookmarks"]);
  });

  it("adds a Group tab after Bookmarks when a group panel is passed", () => {
    renderPopover(<p>Group body</p>);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Contents", "Bookmarks", "Group"]);
  });

  it("shows the group panel when the Group tab is chosen, by keyboard", async () => {
    const user = userEvent.setup();
    renderPopover(<p>Group body</p>);
    expect(screen.queryByText("Group body")).toBeNull();
    screen.getByRole("tab", { name: "Group" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tab", { name: "Group" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Group body")).toBeInTheDocument();
  });
});
