// DEFECTS.md D2 — sub-pixel scroll drift on fractional-DPR devices.
//
// The numbers here are the founder's real capture: an Android phone at
// dpr 2.9750001430511475, chapter "Peaches in Combat", delta 409,
// scrollWidth 7771 (19 pages). Reproduced as arithmetic so the regression is
// pinned without needing the device.

import { describe, expect, it } from "vitest";
import { undriftForNextPage } from "./engine";

/** epub.js's own advance test (managers/default/index.js `next()`). */
const epubWillTurnPage = (c: { scrollLeft: number; offsetWidth: number; scrollWidth: number }, delta: number) =>
  c.scrollLeft + c.offsetWidth + delta <= c.scrollWidth;

function rendition(scrollLeft: number, scrollWidth = 7771, delta = 409) {
  const container = { scrollLeft, offsetWidth: 409, scrollWidth } as HTMLElement;
  return { r: { manager: { container, layout: { delta } } }, container, delta };
}

describe("undriftForNextPage", () => {
  it("rescues the last page of a chapter from accumulated drift", () => {
    // The exact failure: page 18 of 19, scrollLeft crept 0.61px past 17*409.
    const { r, container, delta } = rendition(6953.61);
    expect(epubWillTurnPage(container, delta)).toBe(false); // epub.js would skip

    undriftForNextPage(r);

    expect(epubWillTurnPage(container, delta)).toBe(true); // now it turns
  });

  it("leaves the true end of a chapter alone, so the next chapter is reachable", () => {
    // Page 19 of 19 — scrollLeft 18*409 + drift. There is no page after this;
    // epub.js must stay free to advance the section.
    const { r, container, delta } = rendition(7362.02);
    const before = container.scrollLeft;

    undriftForNextPage(r);

    expect(container.scrollLeft).toBe(before);
    expect(epubWillTurnPage(container, delta)).toBe(false);
  });

  it("cannot manufacture a phantom page — the 1px nudge is far below delta", () => {
    const { r, container } = rendition(6953.61);
    undriftForNextPage(r);
    // Moved back by a hair, not by a page.
    expect(6953 - container.scrollLeft).toBeLessThanOrEqual(1);
    expect(container.scrollLeft).toBeGreaterThan(6953 - 409);
  });

  it("reproduces the measured drift ramp and fixes every page of it", () => {
    // dpr 2.975: a 409px step snaps to 1217 device px = 409.0756 css px.
    const measured = [
      [4090.08, 10], [4499.16, 11], [4908.23, 12], [5317.31, 13],
      [5726.39, 14], [6135.46, 15], [6544.54, 16], [6953.61, 17],
    ] as const;
    for (const [scrollLeft, index] of measured) {
      const { r, container, delta } = rendition(scrollLeft);
      undriftForNextPage(r);
      expect(container.scrollLeft, `page index ${index}`).toBeLessThanOrEqual(index * delta);
      expect(epubWillTurnPage(container, delta), `page index ${index}`).toBe(true);
    }
  });

  it("is inert at the start of a section", () => {
    const { r, container } = rendition(0);
    undriftForNextPage(r);
    expect(container.scrollLeft).toBe(0);
  });

  it("survives a rendition that is not ready yet", () => {
    expect(() => undriftForNextPage(undefined)).not.toThrow();
    expect(() => undriftForNextPage({})).not.toThrow();
    expect(() => undriftForNextPage({ manager: { container: null, layout: { delta: 0 } } })).not.toThrow();
  });
});
