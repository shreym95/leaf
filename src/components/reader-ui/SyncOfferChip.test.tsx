import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SyncOfferChip } from "./SyncOfferChip";

// Wording changed 2026-09-28: "Continue from X" -> "Continue at X" (part of
// the phone-readability fix — a shorter connector before what can already be
// a long chapter title). The chapter-less fallback ("Continue from where you
// left off on another device") is untouched: "from" is idiomatic there and
// it never carries a truncation-prone book title.
describe("SyncOfferChip", () => {
  it("names the offered chapter, and marks it as coming from another device", () => {
    render(
      <SyncOfferChip
        label="Chapter 12"
        onContinue={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Continue at Chapter 12 — synced from another device",
      }),
    ).toBeTruthy();
  });

  it("still offers to continue when the chapter has no name", () => {
    render(
      <SyncOfferChip label={null} onContinue={() => {}} onDismiss={() => {}} />,
    );
    expect(
      screen.getByRole("button", {
        name: "Continue from where you left off on another device",
      }),
    ).toBeTruthy();
  });

  it("continues on click", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(
      <SyncOfferChip
        label="Chapter 12"
        onContinue={onContinue}
        onDismiss={() => {}}
      />,
    );
    await user.click(
      screen.getByRole("button", {
        name: "Continue at Chapter 12 — synced from another device",
      }),
    );
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("offers an explicit dismiss (×) that says what it dismisses", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <SyncOfferChip
        label="Chapter 12"
        onContinue={() => {}}
        onDismiss={onDismiss}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Dismiss continue at Chapter 12 offer" }),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismissing does not call onContinue — it must not navigate", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(
      <SyncOfferChip
        label="Chapter 12"
        onContinue={onContinue}
        onDismiss={() => {}}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Dismiss continue at Chapter 12 offer" }),
    );
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("shortens a long chapter title in the visible pill, but keeps the accessible name accurate (defect: 18ch truncation named no destination)", () => {
    const longTitle = "The Wolf and the Seven Little Kids";
    render(
      <SyncOfferChip
        label={longTitle}
        onContinue={() => {}}
        onDismiss={() => {}}
      />,
    );

    // The accessible name (built from the FULL label) still names the real
    // destination — nothing here relies on the shortened visible text.
    const button = screen.getByRole("button", {
      name: `Continue at ${longTitle} — synced from another device`,
    });
    // The on-screen text is the shortened form, not the full title verbatim —
    // this is what actually fixes the phone-width defect (an unbounded label
    // plus a fixed `18ch` cap used to cut the destination off entirely).
    expect(button.textContent).not.toContain(longTitle);
    expect(button.textContent).toMatch(/^Continue at .+…$/);
  });

  it("renders exactly two controls: continue and dismiss (onDismiss is not optional here)", () => {
    render(
      <SyncOfferChip
        label="Chapter 12"
        onContinue={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
