import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpreadFrame } from "./SpreadFrame";

function renderFrame(overrides: Partial<Parameters<typeof SpreadFrame>[0]> = {}) {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  render(
    <SpreadFrame
      viewerRef={createRef<HTMLDivElement>()}
      frameRef={createRef<HTMLDivElement>()}
      loading={false}
      onPrev={onPrev}
      onNext={onNext}
      {...overrides}
    />,
  );
  return { onPrev, onNext };
}

const widthOf = (name: string) => {
  const cls = screen.getByRole("button", { name }).className;
  return /w-\[(\d+)%\]/.exec(cls)?.[1];
};

describe("SpreadFrame tap zones", () => {
  it("turns the page from the edge zones", async () => {
    const user = userEvent.setup();
    const { onPrev, onNext } = renderFrame();
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("leaves no dead band on touch — the two zones tile the frame", () => {
    // Regression (D1): the zones were 14% each, so ~55px per edge on a phone and
    // the middle 72% of the screen did nothing. A thumb landing mid-page read as
    // "the tap didn't register".
    renderFrame();
    const prev = Number(widthOf("Previous page"));
    const next = Number(widthOf("Next page"));
    expect(prev + next).toBe(100);
    // Forward is the common direction, so it gets the larger share.
    expect(next).toBeGreaterThan(prev);
    for (const w of [prev, next]) expect(w).toBeGreaterThanOrEqual(30);
  });

  it("has no centre zone at all", () => {
    // It used to open the dock deck, and a target that large mid-page caught
    // thumbs meant for a page turn — the deck kept opening unasked (founder,
    // 2026-09-09). The deck now opens only from the dock's settings button.
    renderFrame();
    expect(screen.queryByRole("button", { name: /reading controls/i })).toBeNull();
  });

  it("keeps the narrow edge zones on pointer devices", () => {
    renderFrame();
    for (const name of ["Previous page", "Next page"]) {
      expect(screen.getByRole("button", { name }).className).toContain(
        "lg:w-[14%]",
      );
    }
  });

  it("keeps the tap zones out of the tab sequence but still named", () => {
    renderFrame();
    for (const name of ["Previous page", "Next page"]) {
      const el = screen.getByRole("button", { name });
      expect(el.getAttribute("tabindex")).toBe("-1");
      expect(el.getAttribute("aria-hidden")).toBeNull();
    }
  });
});
