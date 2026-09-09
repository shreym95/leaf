import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RibbonBookmark } from "./RibbonBookmark";

describe("RibbonBookmark", () => {
  it("names itself for the action it will take, and reflects state", () => {
    const { rerender } = render(
      <RibbonBookmark active={false} onToggle={() => {}} />,
    );
    const btn = screen.getByRole("button", { name: "Bookmark this page" });
    expect(btn).toHaveAttribute("aria-pressed", "false");

    rerender(<RibbonBookmark active onToggle={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Remove bookmark from this page" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles on click", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<RibbonBookmark active={false} onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: "Bookmark this page" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("is inert until the reader reports a position", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<RibbonBookmark active={false} disabled onToggle={onToggle} />);
    const btn = screen.getByRole("button", { name: "Bookmark this page" });
    expect(btn).toBeDisabled();
    await user.click(btn).catch(() => {});
    expect(onToggle).not.toHaveBeenCalled();
  });
});
