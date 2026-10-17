import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { HighlightBar, type HighlightBarProps } from "./HighlightBar";

function renderBar(over: Partial<HighlightBarProps> = {}) {
  const props: HighlightBarProps = {
    note: null,
    onNote: vi.fn(),
    onRemove: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<HighlightBar {...props} />);
  return { props, toolbar: screen.getByRole("toolbar", { name: "Highlight actions" }) };
}

describe("HighlightBar note", () => {
  it("shows a Note label, not the note text, when the highlight has one", () => {
    const { toolbar } = renderBar({ note: "Compare with the opening chapter" });
    expect(within(toolbar).getByText("Note")).toBeInTheDocument();
    expect(within(toolbar).queryByText("Compare with the opening chapter")).toBeNull();
  });

  it("keeps Edit note and Remove out of the bar when a note exists (the card holds them)", () => {
    const { toolbar } = renderBar({ note: "Compare" });
    expect(within(toolbar).queryByRole("button", { name: "Edit note" })).toBeNull();
    expect(within(toolbar).queryByRole("button", { name: "Remove" })).toBeNull();
    expect(within(toolbar).getByRole("button", { name: "Close highlight actions" })).toBeInTheDocument();
  });

  it("shows no note text when the highlight has none", () => {
    const { toolbar } = renderBar({ note: null });
    expect(within(toolbar).getByRole("button", { name: "Add note" })).toBeInTheDocument();
    expect(toolbar.querySelector("span.truncate")).toBeNull();
  });

  it("opens the editor from Add note", () => {
    const { props, toolbar } = renderBar({ note: null });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Add note" }));
    expect(props.onNote).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape from a control", () => {
    const { props, toolbar } = renderBar({ note: "Compare" });
    fireEvent.keyDown(within(toolbar).getByRole("button", { name: "Close highlight actions" }), {
      key: "Escape",
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
