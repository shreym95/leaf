import { describe, expect, it, vi } from "vitest";

// The card carries a BookActions menu, which navigates on success.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { render, screen } from "@testing-library/react";
import { BookCard } from "./BookCard";
import type { LibraryBook } from "@/lib/db/books";

function makeBook(overrides: Partial<LibraryBook> = {}): LibraryBook {
  return {
    id: "b1",
    user_id: "u1",
    title: "Frankenstein",
    author: "Mary Shelley",
    source: "standardebooks",
    source_ref: "mary-shelley/frankenstein",
    storage_path: "u1/frankenstein.epub",
    cover_path: null,
    cover_url: null,
    archived_at: null,
    added_at: "2026-01-01T00:00:00Z",
    status: "reading",
    percent: null,
    lastReadAt: null,
    coverUrl: null,
    ...overrides,
  };
}

describe("BookCard", () => {
  it("links the whole card to the reader route", () => {
    render(<BookCard book={makeBook()} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/reader/b1");
  });

  it("shows title and author, and nothing else in the caption", () => {
    render(<BookCard book={makeBook()} />);
    expect(
      screen.getByRole("heading", { name: "Frankenstein" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mary Shelley")).toBeInTheDocument();
    // Provenance was dropped from the card: it was a fourth caption line under
    // every cover and the shelf is meant to be scanned, not read.
    expect(screen.queryByText("Standard Ebooks")).toBeNull();
  });

  it("labels a part-read book with its rounded percent", () => {
    render(<BookCard book={makeBook({ percent: 0.42 })} />);
    expect(screen.getByText("42% READ")).toBeInTheDocument();
  });

  it("labels an unopened book UNREAD", () => {
    render(<BookCard book={makeBook({ percent: null })} />);
    expect(screen.getByText("UNREAD")).toBeInTheDocument();
  });

  it("labels a book opened but at zero progress UNREAD too", () => {
    // 0% and "never opened" are different in the data, but on the shelf they
    // are the same state — you have not read any of it.
    render(<BookCard book={makeBook({ percent: 0 })} />);
    expect(screen.getByText("UNREAD")).toBeInTheDocument();
  });

  it("labels a finished book COMPLETED", () => {
    render(<BookCard book={makeBook({ percent: 1 })} />);
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
  });

  it("clamps out-of-range progress to COMPLETED", () => {
    render(<BookCard book={makeBook({ percent: 1.5 })} />);
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
  });

  it("without a cover, renders the title initial and no image", () => {
    render(<BookCard book={makeBook({ coverUrl: null })} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("F")).toBeInTheDocument();
  });

  it("with a cover, renders an image with descriptive alt text", () => {
    render(
      <BookCard
        book={makeBook({ coverUrl: "https://example.com/cover.jpg" })}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "alt",
      "Cover of Frankenstein",
    );
  });

  it("shows the whole cover, never a crop (DEFECTS D3)", () => {
    // Real covers run every aspect ratio; `object-cover` cropped the edges off
    // any cover that was not the card ratio. The card must contain the cover, not fill.
    render(
      <BookCard
        book={makeBook({ coverUrl: "https://example.com/cover.jpg" })}
      />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveClass("object-contain");
    expect(img).not.toHaveClass("object-cover");
  });
});
