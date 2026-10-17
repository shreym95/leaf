import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SelectionBar } from "./SelectionBar";
import { BarPressHold } from "./BarPressHold";

// The top bar's row, as the shell renders it, with the bar's content going
// through BarPressHold so the press path is the real one.
const libraryClick = vi.fn();
const onAct = vi.fn();

function Harness() {
  const [bar, setBar] = useState<"selection" | null>("selection");
  const live: ReactNode =
    bar === "selection" ? (
      <SelectionBar
        text="the sea"
        onHighlight={() => {
          onAct();
          setBar(null);
        }}
        onNote={() => {}}
        onClose={() => setBar(null)}
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

function catcherOf(bar: HTMLElement): HTMLElement {
  return bar.nextElementSibling as HTMLElement;
}

describe("BarPressHold: a long press keeps the bar until the finger lifts", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
    });
    libraryClick.mockClear();
    onAct.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a long press, then pointerup and click, lands the click on the catcher, not the link", () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), {
      button: 0,
      pointerId: 1,
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();

    const catcher = catcherOf(toolbar());
    fireEvent.pointerUp(catcher, { button: 0, pointerId: 1 });
    fireEvent.click(catcher, { detail: 1 });

    expect(onAct).toHaveBeenCalledTimes(1);
    expect(libraryClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();

    advanceFrame();
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
  });

  it("pointercancel of the arming pointer releases the hold one frame later", () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), {
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerCancel(catcherOf(toolbar()), { pointerId: 1 });
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();

    advanceFrame();
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
  });

  it("a pointerup from a different pointer id does not release the hold", () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), {
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(catcherOf(toolbar()), { button: 0, pointerId: 2 });
    advanceFrame();
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();

    fireEvent.pointerUp(catcherOf(toolbar()), { button: 0, pointerId: 1 });
    advanceFrame();
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
  });
});
