import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import { OfflineIndicator } from "./OfflineIndicator";

/**
 * Stage 4 offline reading, part 3. `navigator.onLine` is read-only in real
 * browsers but jsdom allows redefining it, which is exactly what's needed
 * here to simulate both states without a real network.
 */
function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  cleanup();
  setOnLine(true);
});

describe("OfflineIndicator", () => {
  it("renders nothing while online", () => {
    setOnLine(true);
    render(<OfflineIndicator />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the indicator when the device starts offline", () => {
    setOnLine(false);
    render(<OfflineIndicator />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("offline"),
    );
  });

  it("appears on the `offline` event and clears on `online`", async () => {
    setOnLine(true);
    render(<OfflineIndicator />);
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => {
      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toBeTruthy();

    await act(async () => {
      setOnLine(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("fades out (but stays mounted) rather than covering the reclaimed screen in fullscreen", async () => {
    setOnLine(false);
    render(<OfflineIndicator hidden />);
    const status = screen.getByRole("status");
    // `hidden` is opacity-only (matching ReaderTopBar's own convention) —
    // the element itself never unmounts.
    expect(status.parentElement).toHaveStyle({ opacity: "0" });
  });
});
