import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SelectionBar } from "./SelectionBar";
import { GHOST_CLICK_WINDOW_MS } from "./ghost-click";

// The top bar's row takes the bar's place once the action unmounts the bar. This
// harness stands in for that row: a Library link sits where the bar was, and the
// bar goes away on the action, as the shell does.
const libraryClick = vi.fn();

function Harness({ onAct }: { onAct: () => void }) {
  const [showBar, setShowBar] = useState(true);
  return (
    <div>
      {showBar ? (
        <SelectionBar
          text="the sea"
          onHighlight={() => {
            onAct();
            setShowBar(false);
          }}
          onNote={() => {}}
          onClose={() => {}}
        />
      ) : (
        <a href="/library" onClick={libraryClick}>
          Library
        </a>
      )}
    </div>
  );
}

describe("SelectionBar ghost click", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    libraryClick.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not let the press's follow-up click reach the link underneath", () => {
    const onAct = vi.fn();
    render(<Harness onAct={onAct} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), { button: 0 });
    expect(onAct).toHaveBeenCalledTimes(1);

    const link = screen.getByRole("link", { name: "Library" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
    act(() => {
      link.dispatchEvent(click);
    });

    expect(click.defaultPrevented).toBe(true);
    expect(libraryClick).not.toHaveBeenCalled();
  });

  it("lets a click through again once the guard window has lapsed", () => {
    render(<Harness onAct={() => {}} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), { button: 0 });
    act(() => {
      vi.advanceTimersByTime(GHOST_CLICK_WINDOW_MS + 1);
    });

    fireEvent.click(screen.getByRole("link", { name: "Library" }), { detail: 1 });
    expect(libraryClick).toHaveBeenCalledTimes(1);
  });

  it("does not swallow a click when the press did not act", () => {
    render(
      <>
        <SelectionBar text="the sea" onHighlight={() => {}} onNote={() => {}} onClose={() => {}} />
        <a href="/library" onClick={libraryClick}>
          Library
        </a>
      </>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), { button: 2 });
    fireEvent.click(screen.getByRole("link", { name: "Library" }), { detail: 1 });
    expect(libraryClick).toHaveBeenCalledTimes(1);
  });
});
