import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { SpreadFrame } from "./SpreadFrame";

// Coarse-pointer pass-through. jsdom has no layout or media engine, so this
// asserts the classes that switch the edge buttons off on touch. The real
// behaviour (a long-press reaches the book; a tap turns the page) needs a
// device check.

function renderFrame() {
  render(
    <SpreadFrame
      viewerRef={createRef<HTMLDivElement>()}
      frameRef={createRef<HTMLDivElement>()}
      loading={false}
      onPrev={vi.fn()}
      onNext={vi.fn()}
    />,
  );
}

describe("SpreadFrame on touch", () => {
  it("makes both edge zones pass-through on a coarse pointer", () => {
    renderFrame();
    for (const name of ["Previous page", "Next page"]) {
      expect(screen.getByRole("button", { name }).className).toContain(
        "pointer-coarse:pointer-events-none",
      );
    }
  });

  it("leaves the zones clickable for pointer devices (no fine-pointer override)", () => {
    renderFrame();
    for (const name of ["Previous page", "Next page"]) {
      const cls = screen.getByRole("button", { name }).className;
      expect(cls).not.toContain("pointer-fine:pointer-events-none");
      expect(cls).not.toMatch(/(^|\s)pointer-events-none(\s|$)/);
    }
  });
});
