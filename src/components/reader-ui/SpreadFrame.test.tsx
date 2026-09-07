import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpreadFrame } from "./SpreadFrame";

function renderFrame(overrides: Partial<Parameters<typeof SpreadFrame>[0]> = {}) {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const onToggleChrome = vi.fn();
  render(
    <SpreadFrame
      viewerRef={createRef<HTMLDivElement>()}
      frameRef={createRef<HTMLDivElement>()}
      loading={false}
      onPrev={onPrev}
      onNext={onNext}
      onToggleChrome={onToggleChrome}
      immersive={false}
      {...overrides}
    />,
  );
  return { onPrev, onNext, onToggleChrome };
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

  it("leaves no dead band on touch — the three zones tile the frame", () => {
    // Regression (D1): the zones were 14% each, so ~55px per edge on a phone and
    // the middle 72% of the screen did nothing. A thumb landing mid-page read as
    // "the tap didn't register".
    renderFrame();
    const prev = Number(widthOf("Previous page"));
    const next = Number(widthOf("Next page"));
    const centre = Number(widthOf("Hide reading controls"));
    expect(prev + centre + next).toBe(100);
    // Forward is the common direction, so it gets the largest share.
    expect(next).toBeGreaterThan(prev);
    // Each zone must be a genuinely thumb-sized target, not a sliver.
    for (const w of [prev, centre, next]) expect(w).toBeGreaterThanOrEqual(25);
  });

  it("centre tap toggles the chrome, and is touch-only", async () => {
    const user = userEvent.setup();
    const { onToggleChrome, onPrev, onNext } = renderFrame();
    const centre = screen.getByRole("button", { name: "Hide reading controls" });
    await user.click(centre);
    expect(onToggleChrome).toHaveBeenCalledTimes(1);
    expect(onPrev).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
    // Hidden from pointer devices: with a mouse, a click fires after a
    // drag-select too, so a centre zone would toggle immersive every time a
    // reader selected a word to copy.
    expect(centre.className).toContain("lg:hidden");
  });

  it("names the centre zone for what the tap will do", () => {
    renderFrame({ immersive: true });
    expect(screen.getByRole("button", { name: "Show reading controls" })).toBeTruthy();
  });

  it("keeps the narrow edge zones on pointer devices", () => {
    renderFrame();
    for (const name of ["Previous page", "Next page"]) {
      expect(screen.getByRole("button", { name }).className).toContain("lg:w-[14%]");
    }
  });

  it("keeps the tap zones out of the tab sequence but still named", () => {
    renderFrame();
    for (const name of ["Previous page", "Next page", "Hide reading controls"]) {
      const el = screen.getByRole("button", { name });
      expect(el.getAttribute("tabindex")).toBe("-1");
      expect(el.getAttribute("aria-hidden")).toBeNull();
    }
  });
});
