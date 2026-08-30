import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton } from "./Skeleton";
import LibraryLoading from "@/app/(chrome)/library/loading";
import ChromeLoading from "@/app/(chrome)/loading";
import ReaderLoading from "@/app/(reader)/reader/[bookId]/loading";

describe("Skeleton", () => {
  it("is hidden from assistive tech unless it stands for something", () => {
    const { container } = render(<Skeleton className="h-4 w-8" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("announces itself when given a label", () => {
    render(<Skeleton label="Loading your library" />);
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Loading your library",
    );
  });

  it("does not pulse under prefers-reduced-motion", () => {
    // The duration tokens collapse to 0s, which would freeze a keyframe rather
    // than stop it — so the animation is dropped outright instead (SPEC §3.6).
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass("motion-reduce:animate-none");
  });
});

describe("loading fallbacks", () => {
  it("the library fallback mirrors the real page's shape", () => {
    const { container } = render(<LibraryLoading />);
    // Same eyebrow as page.tsx — it never varies, so there is nothing to guess.
    expect(screen.getByText("Your library")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    // A shelf-shaped grid, not a spinner.
    expect(container.querySelectorAll("li").length).toBeGreaterThan(1);
  });

  it("the chrome fallback announces the wait", () => {
    render(<ChromeLoading />);
    expect(screen.getByRole("status")).toHaveAccessibleName("Loading");
  });

  it("the reader fallback uses the same words as the reader itself", () => {
    // ReaderShell says "Opening the book…" once mounted; matching it here means
    // opening a book reads as one continuous wait, not two different screens.
    render(<ReaderLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Opening the book…");
  });
});
