import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { SelectionBar } from "./SelectionBar";
import { BarPressHold } from "./BarPressHold";

// The top bar's row, as the shell renders it: the slot while a bar is up, and
// the Library link once the slot is empty. The bar's content goes through the
// same BarPressHold the shell uses, so the press path is the real one.
const libraryClick = vi.fn();
const onAct = vi.fn();
const onSave = vi.fn();

// Stands in for the editor a Note press opens. The note editor no longer lives
// in the bar's slot (it is the note card's editor), but this test is about the
// press hold, which needs a field and Save/Cancel to hold, not the card itself.
function NoteStandIn({ onSave, onCancel }: { onSave: (note: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState("");
  return (
    <>
      <input
        autoFocus
        type="text"
        aria-label="Note"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button type="button" onClick={() => onSave(draft)}>
        Save
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </>
  );
}

function Harness() {
  const [bar, setBar] = useState<"selection" | "note" | null>("selection");
  const live: ReactNode =
    bar === "selection" ? (
      <SelectionBar
        text="the sea"
        onHighlight={() => {
          onAct();
          setBar(null);
        }}
        onNote={() => setBar("note")}
        onClose={() => setBar(null)}
      />
    ) : bar === "note" ? (
      <NoteStandIn
        onSave={(note) => {
          onSave(note);
          setBar(null);
        }}
        onCancel={() => setBar(null)}
      />
    ) : null;
  return (
    <BarPressHold live={live}>
      {(shown) => (
        <div>
          {shown ? (
            <div data-bar-slot="">{shown}</div>
          ) : (
            <a href="/library" onClick={libraryClick}>
              Library
            </a>
          )}
        </div>
      )}
    </BarPressHold>
  );
}

function advanceFrame() {
  act(() => {
    vi.advanceTimersByTime(20);
  });
}

function toolbar() {
  return screen.getByRole("toolbar", { name: "Selected text actions" });
}

describe("BarPressHold: a pressed bar action holds the slot", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
    });
    libraryClick.mockClear();
    onAct.mockClear();
    onSave.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a follow-up click after a Highlight press lands on the bar, not the link underneath", () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), { button: 0 });
    expect(onAct).toHaveBeenCalledTimes(1);

    // The press's click is still to come: the row must not be under the finger yet.
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();
    fireEvent.click(within(toolbar()).getByRole("button", { name: "Highlight" }), { detail: 1 });

    expect(onAct).toHaveBeenCalledTimes(1);
    expect(libraryClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();
  });

  it("releases the row one frame after the press's click", () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), { button: 0 });
    fireEvent.click(within(toolbar()).getByRole("button", { name: "Highlight" }), { detail: 1 });
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();
    advanceFrame();
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
  });

  it("a real click after the bar has gone is never swallowed", () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), { button: 0 });
    fireEvent.click(within(toolbar()).getByRole("button", { name: "Highlight" }), { detail: 1 });
    advanceFrame();

    fireEvent.click(screen.getByRole("link", { name: "Library" }), { detail: 1 });
    expect(libraryClick).toHaveBeenCalledTimes(1);
  });

  it("a Note press keeps the note field out of the press's click until that click has passed", () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Note" }), { button: 0 });
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();

    // The press's click lands on the held bar: no Save or Cancel from the press.
    fireEvent.click(within(toolbar()).getByRole("button", { name: "Note" }), { detail: 1 });
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();

    advanceFrame();
    const field = screen.getByRole("textbox", { name: "Note" });
    expect(field).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keyboard activation is unaffected: it acts and the row shows at once", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }), { detail: 0 });
    expect(onAct).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
  });

  it("releases one frame after pointer-up when no click follows", () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), { button: 0 });
    // The held bar is remounted under its wrapper, so the finger's pointer-up
    // lands on the catcher that sits over it, as it would in a browser.
    const catcher = toolbar().nextElementSibling as HTMLElement;
    expect(catcher).toHaveAttribute("aria-hidden", "true");
    fireEvent.pointerUp(catcher, { button: 0 });
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();
    advanceFrame();
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
  });

  it("held at 5 s with the finger down; released one frame after pointerup", () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), { button: 0 });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();

    fireEvent.pointerUp(toolbar().nextElementSibling as HTMLElement, { button: 0 });
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();
    advanceFrame();
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
  });
});
