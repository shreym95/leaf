import { describe, expect, it } from "vitest";
import { isBookFinished } from "./finished";

describe("isBookFinished", () => {
  it("is true only for status 'finished'", () => {
    expect(isBookFinished({ status: "finished" })).toBe(true);
    expect(isBookFinished({ status: "reading" })).toBe(false);
  });

  it("ignores reading progress, even at 100%", () => {
    // A book marked unread at 99.6% (or sitting at 100%) is not finished.
    expect(isBookFinished({ status: "reading", percent: 0.996 } as never)).toBe(false);
    expect(isBookFinished({ status: "reading", percent: 1 } as never)).toBe(false);
  });
});
