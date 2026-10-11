import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReaderDock, type ReaderDockProps } from "./ReaderDock";

function baseProps(over: Partial<ReaderDockProps> = {}): ReaderDockProps {
  return {
    open: false,
    onOpenChange: vi.fn(),
    percent: 0.42,
    chapterLabel: "Chapter 4",
    toc: [],
    onNavigate: vi.fn(),
    onPrevPage: vi.fn(),
    onNextPage: vi.fn(),
    theme: "night",
    onSetTheme: vi.fn(),
    fontSize: 1.06,
    onSetFontSize: vi.fn(),
    bookmarked: false,
    canBookmark: true,
    onToggleBookmark: vi.fn(),
    bookmarks: [],
    onGoToBookmark: vi.fn(),
    onRemoveBookmark: vi.fn(),
    ...over,
  };
}

const MARKERS = [
  { userId: "u2", name: "Ana", percent: 0.25 },
  { userId: "u3", name: "Ben", percent: 0.9 },
];

describe("ReaderDock — group markers", () => {
  // useId() differs per mount; nothing else may.
  const html = (el: React.ReactElement) =>
    render(el).container.innerHTML.replace(/_r_\d+_/g, "_r_");

  it("absent, undefined and empty markers render identical markup", () => {
    const a = html(<ReaderDock {...baseProps()} />);
    const b = html(<ReaderDock {...baseProps({ markers: undefined })} />);
    const c = html(<ReaderDock {...baseProps({ markers: [] })} />);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("with no markers the resting pill keeps its decorative shape", () => {
    const { container } = render(<ReaderDock {...baseProps({ markers: [] })} />);
    expect(screen.queryByRole("group", { name: "Group members" })).toBeNull();
    expect(container.querySelector('[data-testid="group-marker"]')).toBeNull();
    expect(container.querySelectorAll("[role=img]")).toHaveLength(0);
    // The whole resting surface stays hidden from assistive tech, as before.
    const surface = screen.getByText("42%").parentElement;
    expect(surface).toHaveAttribute("aria-hidden", "true");
  });

  it("places each marker at its percent with an accessible name and title", () => {
    render(<ReaderDock {...baseProps({ markers: MARKERS })} />);
    const group = screen.getByRole("group", { name: "Group members" });
    const ana = within(group).getByRole("img", { name: "Ana, 25%" });
    const ben = within(group).getByRole("img", { name: "Ben, 90%" });
    expect(ana).toHaveStyle({ left: "25%" });
    expect(ben).toHaveStyle({ left: "90%" });
    expect(ana).toHaveAttribute("title", "Ana, 25%");
    expect(ben).toHaveAttribute("title", "Ben, 90%");
  });

  it("uses tokens only and no animation on the dots", () => {
    render(<ReaderDock {...baseProps({ markers: MARKERS })} />);
    const dot = screen.getByRole("img", { name: "Ana, 25%" });
    expect(dot.getAttribute("style")).toContain("var(--leaf-accent)");
    expect(dot.getAttribute("style")).not.toMatch(/#[0-9a-f]{3,8}|rgb\(/i);
    expect(dot.className).not.toMatch(/transition|animate/);
  });

  it("keeps the viewer's own percent and does not duplicate it for assistive tech", () => {
    render(<ReaderDock {...baseProps({ markers: MARKERS })} />);
    expect(screen.getByRole("button", { name: /open reading controls — 42% read/i })).toBeInTheDocument();
    expect(screen.getByText("42%")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Chapter 4")).toHaveAttribute("aria-hidden", "true");
  });

  it("clamps out-of-range marker percents onto the track", () => {
    render(
      <ReaderDock
        {...baseProps({
          markers: [
            { userId: "a", name: "Low", percent: -1 },
            { userId: "b", name: "High", percent: 4 },
          ],
        })}
      />,
    );
    expect(screen.getByRole("img", { name: "Low, 0%" })).toHaveStyle({ left: "0%" });
    expect(screen.getByRole("img", { name: "High, 100%" })).toHaveStyle({ left: "100%" });
  });
});
