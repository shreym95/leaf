import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HighlightNoteCard, NOTE_CARD_MAX_LINES } from "./HighlightNoteCard";

function renderCard(note: string) {
  const onSave = vi.fn();
  const onRemove = vi.fn();
  render(<HighlightNoteCard note={note} onSave={onSave} onRemove={onRemove} />);
  return { onSave, onRemove, card: screen.getByRole("region", { name: "Note" }) };
}

describe("HighlightNoteCard", () => {
  it("shows the full note, untruncated, in a labelled region", () => {
    const long = "a very long note that goes on well past one line ".repeat(8).trim();
    const { card } = renderCard(long);
    const text = within(card).getByText(long);
    expect(text.className).not.toContain("truncate");
    expect(text.style.maxHeight).toBe(`${NOTE_CARD_MAX_LINES}lh`);
  });

  it("offers Edit note and Remove, and nothing else", () => {
    const { card } = renderCard("Compare");
    expect(within(card).getByRole("button", { name: "Edit note" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(within(card).getAllByRole("button")).toHaveLength(2);
  });

  it("does not take focus on open", () => {
    renderCard("Compare");
    expect(document.activeElement).toBe(document.body);
  });

  it("swaps to the note editor on Edit note, and Save returns to the card with the new text", async () => {
    const user = userEvent.setup();
    const { card, onSave } = renderCard("Compare");
    await user.click(within(card).getByRole("button", { name: "Edit note" }));
    const field = within(card).getByRole("textbox", { name: "Note" });
    expect(field).toHaveValue("Compare");
    await user.clear(field);
    await user.type(field, "Compare with chapter two");
    await user.click(within(card).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("Compare with chapter two");
    expect(within(card).getByRole("button", { name: "Edit note" })).toBeInTheDocument();
    expect(within(card).queryByRole("textbox")).toBeNull();
  });

  it("saves an emptied note as null", async () => {
    const user = userEvent.setup();
    const { card, onSave } = renderCard("Compare");
    await user.click(within(card).getByRole("button", { name: "Edit note" }));
    await user.clear(within(card).getByRole("textbox", { name: "Note" }));
    await user.click(within(card).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("Cancel returns to the card without saving", async () => {
    const user = userEvent.setup();
    const { card, onSave } = renderCard("Compare");
    await user.click(within(card).getByRole("button", { name: "Edit note" }));
    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(within(card).getByText("Compare")).toBeInTheDocument();
  });

  it("Escape in the editor cancels the edit and does not leave the card", () => {
    const { card, onSave } = renderCard("Compare");
    fireEvent.click(within(card).getByRole("button", { name: "Edit note" }));
    fireEvent.keyDown(within(card).getByRole("textbox", { name: "Note" }), { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(within(card).getByRole("button", { name: "Edit note" })).toBeInTheDocument();
  });

  it("asks before removing, and Keep leaves the note", async () => {
    const user = userEvent.setup();
    const { card, onRemove } = renderCard("keep me");
    await user.click(within(card).getByRole("button", { name: "Remove" }));
    expect(within(card).getByText("Remove note too?")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Keep" }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(within(card).getByRole("button", { name: "Edit note" })).toBeInTheDocument();
  });

  it("removes the note once confirmed", async () => {
    const user = userEvent.setup();
    const { card, onRemove } = renderCard("gone");
    await user.click(within(card).getByRole("button", { name: "Remove" }));
    await user.click(within(card).getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
