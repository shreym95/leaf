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

  it("does not render a tab bar while there is only one tab", () => {
    renderPopover();
    // Contents-only: no tablist scaffolding leaks into the DOM.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("handles an empty table of contents", () => {
    renderPopover({ entries: [] });
    expect(screen.getByText(/no chapter list/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
