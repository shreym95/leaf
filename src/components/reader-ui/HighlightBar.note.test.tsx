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
  it("shows the note text when the highlight has one", () => {
    const { toolbar } = renderBar({ note: "Compare with the opening chapter" });
    expect(within(toolbar).getByText("Compare with the opening chapter")).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "Edit note" })).toBeInTheDocument();
  });

  it("shows no note text when the highlight has none", () => {
    const { toolbar } = renderBar({ note: null });
    expect(within(toolbar).getByRole("button", { name: "Add note" })).toBeInTheDocument();
    expect(toolbar.querySelector("span.truncate")).toBeNull();
  });

  it("truncates the note text to one line", () => {
    const { toolbar } = renderBar({ note: "a very long note ".repeat(20) });
    const text = within(toolbar).getByText(/a very long note/);
    expect(text.className).toContain("truncate");
    expect(text.className).toContain("min-w-0");
  });

  it("opens the editor from Edit note", () => {
    const { props, toolbar } = renderBar({ note: "Compare" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Edit note" }));
    expect(props.onNote).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape from a control", () => {
    const { props, toolbar } = renderBar({ note: "Compare" });
    fireEvent.keyDown(within(toolbar).getByRole("button", { name: "Edit note" }), {
      key: "Escape",
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
