import { describe, expect, it } from "vitest";
import { formatChapterLabel, shortenForJumpChip } from "./chapter-label";

describe("shortenForJumpChip", () => {
  it("leaves a short, already-formatted label untouched", () => {
    expect(shortenForJumpChip("Ch. 4")).toBe("Ch. 4");
    expect(shortenForJumpChip("The Creation")).toBe("The Creation");
  });

  it("leaves null and short titles alone", () => {
    expect(shortenForJumpChip(null)).toBeNull();
  });

  it("shortens a long chapter title at a whole-word boundary, never mid-word (defect: 18ch CSS truncation named no destination)", () => {
    const title = formatChapterLabel("The Wolf and the Seven Little Kids")!;
    const short = shortenForJumpChip(title);

    expect(short).not.toBeNull();
    expect(short).not.toBe(title);
    // Ends with an ellipsis, and every word before it is a whole word from
    // the original title — no fragment like "Litt…".
    expect(short).toMatch(/…$/);
    const words = short!.replace(/…$/, "").trim().split(" ");
    for (const word of words) {
      expect(title.split(" ")).toContain(word);
    }
  });

  it("never shortens a bare-ordinal label — 'Ch. N' is always well under the budget", () => {
    expect(shortenForJumpChip(formatChapterLabel("4"))).toBe("Ch. 4");
    expect(shortenForJumpChip(formatChapterLabel("XIV"))).toBe("Ch. XIV");
  });
});
