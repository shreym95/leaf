import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JumpChip } from "./JumpChip";

describe("JumpChip width (defect: fixed 18ch cut a real chapter title off with no way to read it)", () => {
  it("does not cap the label at a fixed character count", () => {
    render(
      <JumpChip
        icon={<svg aria-hidden />}
        label="Continue at The Wolf and the Seven…"
        ariaLabel="Continue at The Wolf and the Seven Little Kids — synced from another device"
        onActivate={() => {}}
      />,
    );
    const label = screen.getByText(/^Continue at/);
    // The old fixed cap (`max-w-[18ch]`) is gone — a long, already-shortened
    // label is not additionally clipped by an arbitrary character count.
    expect(label.className).not.toMatch(/max-w-\[18ch\]/);
  });

  it("sizes the chip itself off the viewport, not a fixed pixel/character width, so it can use the room a phone actually has", () => {
    const { container } = render(
      <JumpChip
        icon={<svg aria-hidden />}
        label="Continue at Chapter 12"
        ariaLabel="Continue at Chapter 12 — synced from another device"
        onActivate={() => {}}
      />,
    );
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.style.maxWidth).toContain("100vw");
  });
});
