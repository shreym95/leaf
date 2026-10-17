import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SelectionBar, canDefine, defineHref, defineTerm } from "./SelectionBar";

function renderBar(text: string) {
  const onHighlight = vi.fn();
  const onNote = vi.fn();
  const onClose = vi.fn();
  render(
    <SelectionBar text={text} onHighlight={onHighlight} onNote={onNote} onClose={onClose} />,
  );
  return { onHighlight, onNote, onClose, toolbar: screen.getByRole("toolbar", { name: "Selected text actions" }) };
}

describe("SelectionBar: define eligibility", () => {
  it("offers Define for up to three words", () => {
    renderBar("the old sea");
    expect(screen.getByRole("link", { name: "Define in a new tab" })).toBeInTheDocument();
  });

  it("hides Define past three words", () => {
    renderBar("the old grey sea");
    expect(screen.queryByRole("link", { name: /Define/ })).toBeNull();
  });

  it("hides Define past forty characters, even as one word", () => {
    renderBar("x".repeat(41));
    expect(screen.queryByRole("link", { name: /Define/ })).toBeNull();
  });

  it("trims punctuation before judging and querying", () => {
    expect(canDefine("“melancholy,”")).toBe(true);
    expect(defineTerm("“melancholy,”")).toBe("melancholy");
    renderBar("“melancholy,”");
    const link = screen.getByRole("link", { name: "Define in a new tab" });
    expect(link.getAttribute("href")).toBe(defineHref("melancholy"));
  });

  it("encodes the query and opens in a new tab with rel noopener noreferrer", () => {
    renderBar("café");
    const link = screen.getByRole("link", { name: "Define in a new tab" });
    expect(link).toHaveAttribute("href", "https://www.google.com/search?q=define+caf%C3%A9");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does not offer Define for blank or punctuation-only text", () => {
    expect(canDefine("   ")).toBe(false);
    expect(canDefine("—")).toBe(false);
  });
});

describe("SelectionBar: actions", () => {
  it("Highlight acts on pointer-down, once, and the click that follows does not act again", async () => {
    const user = userEvent.setup();
    const { onHighlight } = renderBar("the sea");
    await user.click(screen.getByRole("button", { name: "Highlight" }));
    expect(onHighlight).toHaveBeenCalledTimes(1);
  });

  it("acts on the primary button's pointer-down and cancels its default", () => {
    const { onHighlight } = renderBar("the sea");
    const allowed = fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), {
      button: 0,
    });
    expect(allowed).toBe(false); // default prevented: focus and selection stay put
    expect(onHighlight).toHaveBeenCalledTimes(1);
  });

  it("ignores a non-primary pointer-down", () => {
    const { onHighlight, onNote } = renderBar("the sea");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), { button: 2 });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Note" }), { button: 2 });
    expect(onHighlight).not.toHaveBeenCalled();
    expect(onNote).not.toHaveBeenCalled();
  });

  it("Note acts on pointer-down", () => {
    const { onNote } = renderBar("the sea");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Note" }), { button: 0 });
    expect(onNote).toHaveBeenCalledTimes(1);
  });

  it("keyboard activation works: a click with detail 0 acts", async () => {
    const user = userEvent.setup();
    const { onHighlight, onNote } = renderBar("the sea");
    screen.getByRole("button", { name: "Highlight" }).focus();
    await user.keyboard("{Enter}");
    expect(onHighlight).toHaveBeenCalledTimes(1);
    screen.getByRole("button", { name: "Note" }).focus();
    await user.keyboard(" ");
    expect(onNote).toHaveBeenCalledTimes(1);
  });

  it("✕ clears the selection", async () => {
    const user = userEvent.setup();
    const { onClose, toolbar } = renderBar("the sea");
    await user.click(within(toolbar).getByRole("button", { name: "Clear selection" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is a labelled toolbar with real buttons, all in the tab sequence", () => {
    const { toolbar } = renderBar("the sea");
    expect(toolbar).toHaveAttribute("aria-label", "Selected text actions");
    for (const name of ["Highlight", "Note", "Clear selection"]) {
      expect(within(toolbar).getByRole("button", { name })).not.toHaveAttribute("tabindex", "-1");
    }
  });

  it("shows no debug or instruction text", () => {
    const { toolbar } = renderBar("the grey old sea");
    expect(toolbar.textContent).toBe("HighlightNote✕");
  });
});
