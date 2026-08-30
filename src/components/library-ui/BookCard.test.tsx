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

  it("shows title, author and where the book came from", () => {
    render(<BookCard book={makeBook()} />);
    expect(
      screen.getByRole("heading", { name: "Frankenstein" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mary Shelley")).toBeInTheDocument();
    expect(screen.getByText("Standard Ebooks")).toBeInTheDocument();
  });

  it("shows progress as a meter, not a status label", () => {
    // "Reading" was true of almost every book and told the reader nothing.
    render(<BookCard book={makeBook({ percent: 0.42 })} />);
    const meter = screen.getByRole("progressbar", { name: "Reading progress" });
    expect(meter).toHaveAttribute("aria-valuenow", "42");
    // Screen readers announce the same words the old text carried.
    expect(meter).toHaveAttribute("aria-valuetext", "42%");
    expect(screen.queryByText(/^Reading$/)).toBeNull();
  });

  it("announces an unopened book as not started", () => {
    render(<BookCard book={makeBook({ percent: null })} />);
    const meter = screen.getByRole("progressbar", { name: "Reading progress" });
    expect(meter).toHaveAttribute("aria-valuenow", "0");
    expect(meter).toHaveAttribute("aria-valuetext", "Not started");
  });

  it("calls a finished book finished, and clamps out-of-range progress", () => {
    render(<BookCard book={makeBook({ percent: 1.5 })} />);
    const meter = screen.getByRole("progressbar", { name: "Reading progress" });
    expect(meter).toHaveAttribute("aria-valuenow", "100");
    expect(meter).toHaveAttribute("aria-valuetext", "Finished");
  });

  it("gives the progress meter a bounded range for assistive tech", () => {
    render(<BookCard book={makeBook({ percent: 0.42 })} />);
    const meter = screen.getByRole("progressbar", { name: "Reading progress" });
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
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
});
