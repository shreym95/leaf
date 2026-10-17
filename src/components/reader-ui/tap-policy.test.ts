import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLLAPSE_GRACE_MS,
  HIGHLIGHT_TAP_GUARD_MS,
  decideContentTap,
  isCoarsePointer,
  type ContentTapInput,
} from "./tap-policy";

const TOUCH: ContentTapInput = {
  coarse: true,
  selectionActive: false,
  msSinceCollapse: Infinity,
  msSinceHighlightTap: Infinity,
  xFraction: 0.5,
};

describe("decideContentTap", () => {
  it("ignores every tap from a fine pointer (the edge buttons own mouse turns)", () => {
    expect(decideContentTap({ ...TOUCH, coarse: false, xFraction: 0.1 })).toBe("ignore");
    expect(decideContentTap({ ...TOUCH, coarse: false, xFraction: 0.9 })).toBe("ignore");
    expect(decideContentTap({ ...TOUCH, coarse: false, selectionActive: true })).toBe("ignore");
  });

  it("clears an active selection and does not turn", () => {
    expect(decideContentTap({ ...TOUCH, selectionActive: true, xFraction: 0.9 })).toBe(
      "clear-selection",
    );
    expect(decideContentTap({ ...TOUCH, selectionActive: true, xFraction: 0.1 })).toBe(
      "clear-selection",
    );
  });

  it("ignores a tap within the collapse grace window", () => {
    expect(
      decideContentTap({ ...TOUCH, msSinceCollapse: COLLAPSE_GRACE_MS - 1, xFraction: 0.9 }),
    ).toBe("ignore");
  });

  it("turns on the boundary of the collapse grace window", () => {
    expect(
      decideContentTap({ ...TOUCH, msSinceCollapse: COLLAPSE_GRACE_MS, xFraction: 0.9 }),
    ).toBe("next");
  });

  it("ignores the content tap that follows a highlight tap", () => {
    expect(
      decideContentTap({ ...TOUCH, msSinceHighlightTap: HIGHLIGHT_TAP_GUARD_MS - 1, xFraction: 0.9 }),
    ).toBe("ignore");
  });

  it("turns back for taps left of 35% and forward for the rest", () => {
    expect(decideContentTap({ ...TOUCH, xFraction: 0 })).toBe("prev");
    expect(decideContentTap({ ...TOUCH, xFraction: 0.349 })).toBe("prev");
    expect(decideContentTap({ ...TOUCH, xFraction: 0.35 })).toBe("next");
    expect(decideContentTap({ ...TOUCH, xFraction: 0.999 })).toBe("next");
  });

  it("a selection clear wins over the grace windows", () => {
    expect(
      decideContentTap({
        ...TOUCH,
        selectionActive: true,
        msSinceCollapse: 0,
        msSinceHighlightTap: 0,
      }),
    ).toBe("clear-selection");
  });
});

describe("isCoarsePointer", () => {
  afterEach(() => {
    // @ts-expect-error — remove the stub so other suites see the jsdom default
    delete window.matchMedia;
  });

  it("is false when matchMedia is unavailable", () => {
    expect(isCoarsePointer()).toBe(false);
  });

  it("reads the (pointer: coarse) query", () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === "(pointer: coarse)" }));
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMedia });
    expect(isCoarsePointer()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(pointer: coarse)");
  });
});
