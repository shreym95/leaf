import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HighlightNoteCard, NOTE_CARD_MAX_LINES, NOTE_MAX } from "./HighlightNoteCard";
import { HighlightBar } from "./HighlightBar";
import { ReaderTopBar } from "./ReaderTopBar";
import { barEdgeStyle, barRowClass, barButtonClass } from "./bar-styles";

// The card is presentational: the shell owns whether the editor is open and
// what the draft says. This harness plays that role for the card alone.
interface HarnessProps {
  note: string;
  editing?: boolean;
  onSave?: (note: string | null) => void;
  onCancel?: () => void;
  onRemove?: () => void;
}

function Harness({ note, editing: startEditing = false, onSave = vi.fn(), onCancel = vi.fn(), onRemove = vi.fn() }: HarnessProps) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(note);
  return (
    <HighlightNoteCard
      note={note}
      editing={editing}
      draft={draft}
      onDraftChange={setDraft}
      onEdit={() => {
        setDraft(note);
        setEditing(true);
      }}
      onSave={(next) => {
        onSave(next);
        setEditing(false);
      }}
      onCancel={() => {
        onCancel();
        setEditing(false);
      }}
      onRemove={onRemove}
    />
  );
}

function renderCard(note: string, props: Omit<HarnessProps, "note"> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onRemove = vi.fn();
  render(
    <Harness note={note} onSave={onSave} onCancel={onCancel} onRemove={onRemove} {...props} />,
  );
  return { onSave, onCancel, onRemove, card: screen.getByRole("region", { name: "Note" }) };
}

describe("HighlightNoteCard — read view", () => {
  it("shows the full note, untruncated, in a labelled region", () => {
    const long = "a very long note that goes on well past one line ".repeat(8).trim();
    const { card } = renderCard(long);
    const text = within(card).getByText(long);
    expect(text.className).not.toContain("truncate");
    expect(text.style.maxHeight).toBe(`${NOTE_CARD_MAX_LINES}lh`);
  });

  it("sets the note in the reader's own type, not the chrome's", () => {
    const { card } = renderCard("Compare");
    const text = within(card).getByText("Compare");
    expect(text.className).toContain("font-reader-serif");
    expect(text.className).toContain("[font-size:var(--leaf-reader-font-size)]");
    expect(text.className).toContain("[line-height:var(--leaf-reader-leading)]");
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

  it("Edit note opens the editor in the card, on the saved text", async () => {
    const user = userEvent.setup();
    const { card } = renderCard("Compare");
    await user.click(within(card).getByRole("button", { name: "Edit note" }));
    expect(within(card).getByRole("textbox", { name: "Note" })).toHaveValue("Compare");
  });
});

describe("HighlightNoteCard — editor", () => {
  it("is a labelled textarea in the card, in the note's own type, focused with the caret at the end", () => {
    const { card } = renderCard("Compare", { editing: true });
    const field = within(card).getByRole("textbox", { name: "Note" });
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveFocus();
    expect((field as HTMLTextAreaElement).selectionStart).toBe("Compare".length);
    expect(field.className).toContain("font-reader-serif");
    expect(field.className).toContain("[font-size:var(--leaf-reader-font-size)]");
    expect(field.className).toContain("[line-height:var(--leaf-reader-leading)]");
    expect(field.className).toContain("bg-transparent");
    expect(field.style.maxHeight).toBe(`${NOTE_CARD_MAX_LINES}lh`);
  });

  it("shows Save and Cancel in place of Edit note and Remove, with the n/500 counter", () => {
    const { card } = renderCard("Compare", { editing: true });
    expect(within(card).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Edit note" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Remove" })).toBeNull();
    expect(within(card).getByText(`7/${NOTE_MAX}`)).toBeInTheDocument();
  });

  it("Save writes the trimmed draft and returns to the read view", async () => {
    const user = userEvent.setup();
    const { card, onSave } = renderCard("Compare", { editing: true });
    const field = within(card).getByRole("textbox", { name: "Note" });
    await user.clear(field);
    await user.type(field, "  Compare with chapter two  ");
    await user.click(within(card).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("Compare with chapter two");
    expect(within(card).getByRole("button", { name: "Edit note" })).toBeInTheDocument();
    expect(within(card).queryByRole("textbox")).toBeNull();
  });

  it("saves an emptied note as null", async () => {
    const user = userEvent.setup();
    const { card, onSave } = renderCard("Compare", { editing: true });
    await user.clear(within(card).getByRole("textbox", { name: "Note" }));
    await user.click(within(card).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("disables Save and marks the field invalid over 500 characters", () => {
    const { card, onSave } = renderCard("Compare", { editing: true });
    const field = within(card).getByRole("textbox", { name: "Note" });
    fireEvent.change(field, { target: { value: "n".repeat(NOTE_MAX + 1) } });
    expect(within(card).getByText(`${NOTE_MAX + 1}/${NOTE_MAX}`)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("accepts exactly 500 characters", () => {
    const { card } = renderCard("Compare", { editing: true });
    fireEvent.change(within(card).getByRole("textbox", { name: "Note" }), {
      target: { value: "n".repeat(NOTE_MAX) },
    });
    expect(within(card).getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("Cancel discards the draft and does not save", async () => {
    const user = userEvent.setup();
    const { card, onSave, onCancel } = renderCard("Compare", { editing: true });
    await user.type(within(card).getByRole("textbox", { name: "Note" }), " more");
    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Escape in the editor cancels, and does not save or leave the card", () => {
    const { card, onSave, onCancel } = renderCard("Compare", { editing: true });
    fireEvent.keyDown(within(card).getByRole("textbox", { name: "Note" }), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(card).toBeInTheDocument();
  });

  it("Escape from a control in the editor cancels too", () => {
    const { card, onCancel } = renderCard("Compare", { editing: true });
    fireEvent.keyDown(within(card).getByRole("button", { name: "Save" }), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("returns focus to Edit note when editing ends", async () => {
    const user = userEvent.setup();
    const { card } = renderCard("Compare");
    await user.click(within(card).getByRole("button", { name: "Edit note" }));
    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(within(card).getByRole("button", { name: "Edit note" })).toHaveFocus();
  });
});

describe("HighlightNoteCard — one left edge", () => {
  // jsdom has no layout, so the alignment is asserted on the tokens each element
  // uses: the same inset as the bar's label, with any button padding pulled back.
  it("hangs the card from the bar's own inset", () => {
    const { card } = renderCard("Compare");
    expect(card.style.paddingLeft).toBe(barEdgeStyle.paddingLeft);
    expect(card.style.paddingRight).toBe(barEdgeStyle.paddingRight);
  });

  it("gives the note text and the editor no horizontal padding of their own", () => {
    const { card } = renderCard("Compare");
    const text = within(card).getByText("Compare");
    expect(text.className).not.toMatch(/(^|\s)p[xl]?-/);
    expect(text.className).not.toMatch(/(^|\s)px-/);
  });

  it("pulls the action row back by the same token its buttons pad with", () => {
    const { card } = renderCard("Compare");
    const row = within(card).getByRole("button", { name: "Edit note" }).parentElement!;
    expect(row.className).toContain(barRowClass);
    expect(barRowClass).toContain("var(--leaf-space-2)");
    expect(barButtonClass).toContain("px-[var(--leaf-space-2)]");
  });

  it("keeps the editor's row on the same inset as the read view's", () => {
    const { card } = renderCard("Compare", { editing: true });
    const row = within(card).getByRole("button", { name: "Save" }).parentElement!;
    expect(row.className).toContain(barRowClass);
    expect(within(card).getByRole("textbox", { name: "Note" }).className).not.toMatch(/(^|\s)px-/);
  });

  it("shares the top bar's left edge: the label, the note and the header use one inset", () => {
    render(
      <ReaderTopBar
        immersive={false}
        overlay={false}
        hidden={false}
        onToggleImmersive={() => {}}
        slot={<HighlightBar note="Compare" onNote={() => {}} onRemove={() => {}} onClose={() => {}} />}
        card={<Harness note="Compare" />}
      />,
    );
    const header = document.querySelector("header") as HTMLElement;
    const card = screen.getByRole("region", { name: "Note" });
    const label = within(screen.getByRole("toolbar", { name: "Highlight actions" })).getByText("Note");
    expect(header.style.paddingLeft).toBe(card.style.paddingLeft);
    expect(header.style.paddingRight).toBe(card.style.paddingRight);
    expect(label.className).not.toMatch(/(^|\s)px-/);
    expect(within(card).getByText("Compare").className).not.toMatch(/(^|\s)px-/);
  });
});
