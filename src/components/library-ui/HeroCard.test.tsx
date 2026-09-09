import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroCard, splitHeroBook } from "./HeroCard";
import type { LibraryBook } from "@/lib/db/books";

function makeBook(overrides: Partial<LibraryBook> = {}): LibraryBook {
  return {
    id: "b1",
    user_id: "u1",
    title: "Frankenstein; or, The Modern Prometheus",
    author: "Mary Wollstonecraft Shelley",
    source: "standardebooks",
    source_ref: "mary-shelley/frankenstein",
    storage_path: "u1/frankenstein.epub",
    cover_path: null,
    cover_url: null,
    archived_at: null,
    added_at: "2026-01-01T00:00:00Z",
    status: "reading",
    percent: 0.74,
    lastReadAt: "2026-09-01T00:00:00Z",
    coverUrl: null,
    ...overrides,
  };
}

describe("splitHeroBook", () => {
  it("picks the book with the most recent lastReadAt as the hero", () => {
    const books = [
      makeBook({ id: "a", lastReadAt: "2026-08-01T00:00:00Z" }),
      makeBook({ id: "b", lastReadAt: "2026-09-05T00:00:00Z" }),
      makeBook({ id: "c", lastReadAt: "2026-07-01T00:00:00Z" }),
    ];
    const { hero, shelf } = splitHeroBook(books);
    expect(hero?.id).toBe("b");
    // The hero is lifted out of the grid so it never shows twice.
    expect(shelf.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("does not depend on the input already being sorted", () => {
    const books = [
      makeBook({ id: "old", lastReadAt: "2026-01-01T00:00:00Z" }),
      makeBook({ id: "newest", lastReadAt: "2026-09-09T00:00:00Z" }),
      makeBook({ id: "mid", lastReadAt: "2026-05-01T00:00:00Z" }),
    ];
    expect(splitHeroBook(books).hero?.id).toBe("newest");
  });

  it("renders no hero when nothing has ever been opened", () => {
    const books = [
      makeBook({ id: "a", percent: null, lastReadAt: null }),
      makeBook({ id: "b", percent: null, lastReadAt: null }),
    ];
    const { hero, shelf } = splitHeroBook(books);
    expect(hero).toBeNull();
    expect(shelf.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("renders no hero when disabled (the hidden/archived view)", () => {
    const books = [makeBook({ id: "a", lastReadAt: "2026-09-01T00:00:00Z" })];
    const { hero, shelf } = splitHeroBook(books, { enabled: false });
    expect(hero).toBeNull();
    expect(shelf).toEqual(books);
  });

  it("ignores never-opened books even when they sort first by id", () => {
    const books = [
      makeBook({ id: "aaa", lastReadAt: null }),
      makeBook({ id: "zzz", lastReadAt: "2026-06-01T00:00:00Z" }),
    ];
    expect(splitHeroBook(books).hero?.id).toBe("zzz");
  });
});

describe("HeroCard", () => {
  it("shows the eyebrow, title, author and percent", () => {
    render(<HeroCard book={makeBook()} />);
    expect(screen.getByText("Continue reading")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Frankenstein; or, The Modern Prometheus",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Mary Wollstonecraft Shelley"),
    ).toBeInTheDocument();
    expect(screen.getByText("74%")).toBeInTheDocument();
  });

  it("points the CTA at the reader route for this book", () => {
    render(<HeroCard book={makeBook({ id: "frank-1" })} />);
    const cta = screen.getByRole("link", { name: /continue reading/i });
    expect(cta).toHaveAttribute("href", "/reader/frank-1");
  });

  it("exposes progress as a bounded progressbar", () => {
    render(<HeroCard book={makeBook({ percent: 0.74 })} />);
    const bar = screen.getByRole("progressbar", { name: "Reading progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "74");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("treats a book opened but not yet measured as 0%", () => {
    // Opened (so it can be the hero) but `percent` still null — locations not
    // generated yet. The bar must not render NaN or crash.
    render(<HeroCard book={makeBook({ percent: null })} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Reading progress" }),
    ).toHaveAttribute("aria-valuenow", "0");
  });

  it("shows the whole cover, never a crop (DEFECTS D3)", () => {
    render(
      <HeroCard book={makeBook({ coverUrl: "https://example.com/c.jpg" })} />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveClass("object-contain");
    expect(img).not.toHaveClass("object-cover");
  });

  it("falls back to the title initial when there is no cover", () => {
    render(<HeroCard book={makeBook({ coverUrl: null })} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("F")).toBeInTheDocument();
  });
});
