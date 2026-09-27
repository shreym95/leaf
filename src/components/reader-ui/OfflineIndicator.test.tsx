import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  describe("auto-dismiss", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("auto-hides a few seconds after appearing on an offline transition", () => {
      setOnLine(true);
      render(<OfflineIndicator />);
      expect(screen.queryByRole("status")).toBeNull();

      act(() => {
        setOnLine(false);
        window.dispatchEvent(new Event("offline"));
      });
      expect(screen.getByRole("status")).toBeTruthy();

      // Still well within the attention window.
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.getByRole("status")).toBeTruthy();

      // At the 6s auto-hide threshold — the fade starts (opacity 0), still
      // mounted for the fade's own grace period.
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      const fading = screen.getByRole("status");
      expect(fading.parentElement).toHaveStyle({ opacity: "0" });

      // Once that grace period elapses too, it's gone from the DOM.
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.queryByRole("status")).toBeNull();

      // The device is still offline the whole time — this was a timer, not
      // a reconnect.
      expect(navigator.onLine).toBe(false);
    });

    it("shows again on a second offline transition after auto-hiding from the first", () => {
      setOnLine(true);
      render(<OfflineIndicator />);

      act(() => {
        setOnLine(false);
        window.dispatchEvent(new Event("offline"));
      });
      expect(screen.getByRole("status")).toBeTruthy();

      // Let the first transition's pill fully auto-hide. Advanced in two
      // steps (not one 7000ms jump) so the "leaving" state's own effect gets
      // a chance to run and schedule the unmount timer in between — a fake
      // timers/effects sequencing detail of the test, not of the component.
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole("status")).toBeNull();

      // Reconnect, then drop again — a fresh transition.
      act(() => {
        setOnLine(true);
        window.dispatchEvent(new Event("online"));
      });
      act(() => {
        setOnLine(false);
        window.dispatchEvent(new Event("offline"));
      });
      expect(screen.getByRole("status")).toBeTruthy();
    });

    it("hides immediately on reconnect, even mid-attention-window, with no lingering fade", () => {
      setOnLine(true);
      render(<OfflineIndicator />);

      act(() => {
        setOnLine(false);
        window.dispatchEvent(new Event("offline"));
      });
      expect(screen.getByRole("status")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(1000); // well before the 6s auto-hide
        setOnLine(true);
        window.dispatchEvent(new Event("online"));
      });
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
