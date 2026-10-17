import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { SelectionBar } from "./SelectionBar";
import { BarPressHold, useBarPressArm } from "./BarPressHold";

// The safety cap for an armed hold that never saw its pointer go down.
const SAFETY_CAP_MS = 10_000;

// A control that arms the hold without any pointer going down (mouse-down only).
function ArmWithoutDown() {
  const arm = useBarPressArm();
  return (
    <button type="button" onMouseDown={arm}>
      Arm without down
    </button>
  );
}

function ArmHarness() {
  return (
    <BarPressHold live={<button type="button">Bar</button>}>
      {(shown) => (
        <div>
          {shown}
          <ArmWithoutDown />
        </div>
      )}
    </BarPressHold>
  );
}

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

function restoreVisibility() {
  delete (document as unknown as Record<string, unknown>).visibilityState;
}

function heldCatcher(): Element | null {
  return document.querySelector('span[aria-hidden="true"]');
}

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

  it("window blur releases the hold at once", () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), {
      button: 0,
      pointerId: 1,
    });
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();

    fireEvent.blur(window);
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
  });

  it("the page turning hidden releases the hold at once", () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }), {
      button: 0,
      pointerId: 1,
    });
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();

    try {
      setVisibility("hidden");
      fireEvent(document, new Event("visibilitychange"));
    } finally {
      restoreVisibility();
    }
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
  });

  it("two fingers: the hold releases only after both lift", () => {
    render(<Harness />);
    // Note leaves the bar up, so the second press still arms with content to hold.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Note" }), {
      button: 0,
      pointerId: 1,
    });
    // The second finger presses Highlight and arms the hold again.
    fireEvent.pointerDown(within(toolbar()).getByRole("button", { name: "Highlight" }), {
      button: 0,
      pointerId: 2,
    });

    const catcher = catcherOf(toolbar());
    fireEvent.pointerUp(catcher, { button: 0, pointerId: 1 });
    fireEvent.click(catcher, { detail: 1 });
    advanceFrame();
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();

    fireEvent.pointerUp(catcher, { button: 0, pointerId: 2 });
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();
    advanceFrame();
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
  });

  it("armed with no pointer down ever seen: held to the 10 s safety cap, not before", () => {
    render(<ArmHarness />);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Arm without down" }));
    expect(heldCatcher()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(SAFETY_CAP_MS - 1);
    });
    expect(heldCatcher()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(heldCatcher()).toBeNull();
    expect(within(document.body).getByRole("button", { name: "Bar" })).toBeInTheDocument();
  });
});
