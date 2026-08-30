import { describe, expect, it } from "vitest";
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
    cover_url: null,
    added_at: "2026-01-01T00:00:00Z",
    status: "reading",
    percent: null,
    lastReadAt: null,
    ...overrides,
  };
}

describe("BookCard", () => {
  it("links the whole card to the reader route", () => {
    render(<BookCard book={makeBook()} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/reader/b1");
  });

  it("shows title, author and where the book came from", () => {
    render(<BookCard book={makeBook()} />);
    expect(
      screen.getByRole("heading", { name: "Frankenstein" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mary Shelley")).toBeInTheDocument();
    expect(screen.getByText("Standard Ebooks")).toBeInTheDocument();
  });

  it("shows progress, not a status label", () => {
    // "Reading" was true of almost every book and told the reader nothing.
    render(<BookCard book={makeBook({ percent: 0.42 })} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.queryByText(/^Reading$/)).toBeNull();
  });

  it("says so when a book has never been opened", () => {
    render(<BookCard book={makeBook({ percent: null })} />);
    expect(screen.getByText("Not started")).toBeInTheDocument();
  });

  it("calls a finished book finished, and clamps out-of-range progress", () => {
    render(<BookCard book={makeBook({ percent: 1 })} />);
    expect(screen.getByText("Finished")).toBeInTheDocument();
  });

  it("without a cover, renders the title initial and no image", () => {
    render(<BookCard book={makeBook({ cover_url: null })} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("F")).toBeInTheDocument();
  });

  it("with a cover, renders an image with descriptive alt text", () => {
    render(
      <BookCard
        book={makeBook({ cover_url: "https://example.com/cover.jpg" })}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "alt",
      "Cover of Frankenstein",
    );
  });
});
