import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TocPopover } from "./TocPopover";

function renderPopover(notesPanel?: ReactNode) {
  render(
    <TocPopover
      id="toc"
      open
      entries={[{ href: "ch1.html", label: "Chapter 1" }]}
      currentLabel={null}
      onNavigate={vi.fn()}
      notesPanel={notesPanel}
    />,
  );
}

describe("TocPopover — Contents · Notes", () => {
  it("offers Contents and Notes as tabs, Contents first, and no Bookmarks tab", () => {
    renderPopover(<p>Notes body</p>);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Contents", "Notes"]);
  });

  it("shows the notes panel when the Notes tab is chosen", async () => {
    const user = userEvent.setup();
    renderPopover(<p>Notes body</p>);

    expect(screen.queryByText("Notes body")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Notes" }));
    expect(screen.getByRole("tab", { name: "Notes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Notes body")).toBeInTheDocument();
  });
});
