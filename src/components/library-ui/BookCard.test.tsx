import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BookCard } from "./BookCard";
import type { Book } from "@/lib/types";

function makeBook(overrides: Partial<Book> = {}): Book {
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
    ...overrides,
  };
}

describe("BookCard", () => {
  it("links the whole card to the reader route", () => {
    render(<BookCard book={makeBook()} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/reader/b1");
  });

  it("shows title, author and a source/status line", () => {
    render(<BookCard book={makeBook()} />);
    expect(
      screen.getByRole("heading", { name: "Frankenstein" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mary Shelley")).toBeInTheDocument();
    expect(screen.getByText(/Standard Ebooks/)).toBeInTheDocument();
    expect(screen.getByText(/Reading/)).toBeInTheDocument();
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
