import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReturnChip } from "./ReturnChip";
import { formatChapterLabel } from "./chapter-label";

describe("ReturnChip", () => {
  it("names where it will take you back to", () => {
    render(<ReturnChip label="Ch. 4" onReturn={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Return to Ch. 4" }),
    ).toBeTruthy();
  });

  it("still offers a way back when the chapter has no name", () => {
    render(<ReturnChip label={null} onReturn={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Return to where you were" }),
    ).toBeTruthy();
  });

  it("returns on click", async () => {
    const user = userEvent.setup();
    const onReturn = vi.fn();
    render(<ReturnChip label="Ch. 4" onReturn={onReturn} />);
    await user.click(screen.getByRole("button", { name: "Return to Ch. 4" }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});

describe("formatChapterLabel", () => {
  it("prefixes a bare ordinal so it is not a hanging number", () => {
    // Calibre exports commonly give the TOC a bare number.
    expect(formatChapterLabel("4")).toBe("Ch. 4");
    expect(formatChapterLabel("XIV")).toBe("Ch. XIV");
  });

  it("leaves a real title exactly as the book wrote it", () => {
    // Prefixing "Chapter" onto a named chapter would be inventing structure.
    expect(formatChapterLabel("The Creation")).toBe("The Creation");
    expect(formatChapterLabel("Peaches in Combat")).toBe("Peaches in Combat");
  });

  it("treats empty and missing labels as no label", () => {
    expect(formatChapterLabel("   ")).toBeNull();
    expect(formatChapterLabel(null)).toBeNull();
  });
});
