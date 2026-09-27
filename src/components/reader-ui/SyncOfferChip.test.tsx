import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SyncOfferChip } from "./SyncOfferChip";

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
        name: "Continue from Chapter 12 — synced from another device",
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
        name: "Continue from Chapter 12 — synced from another device",
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
      screen.getByRole("button", { name: "Dismiss continue from Chapter 12 offer" }),
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
      screen.getByRole("button", { name: "Dismiss continue from Chapter 12 offer" }),
    );
    expect(onContinue).not.toHaveBeenCalled();
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
