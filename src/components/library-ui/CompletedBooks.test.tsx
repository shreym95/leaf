import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { COMPLETED_OPEN_KEY, CompletedBooks } from "./CompletedBooks";
import type { LibraryBook } from "@/lib/db/books";

function makeBook(overrides: Partial<LibraryBook> = {}): LibraryBook {
  return {
    id: "b1",
    user_id: "u1",
    title: "Frankenstein",
    author: "Mary Shelley",
    source: "standardebooks",
    source_ref: null,
    storage_path: null,
    cover_path: null,
    cover_url: null,
    archived_at: null,
    added_at: "2026-01-01T00:00:00Z",
    status: "finished",
    finished_at: "2026-10-02T10:00:00Z",
    percent: 1,
    lastReadAt: "2026-10-02T10:00:00Z",
    coverUrl: null,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("CompletedBooks", () => {
  it("renders nothing at all when there are no completed books", () => {
    const { container } = render(<CompletedBooks books={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is collapsed by default, showing only the label and count", () => {
    render(<CompletedBooks books={[makeBook(), makeBook({ id: "b2" })]} />);
    const toggle = screen.getByRole("button", { name: /completed books/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Completed Books");
    expect(toggle).toHaveTextContent("2");
    // The rows are not reachable while collapsed.
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("expands on click and wires aria-controls to the list", () => {
    render(<CompletedBooks books={[makeBook()]} />);
    const toggle = screen.getByRole("button", { name: /completed books/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("list");
    expect(list.id).toBe(toggle.getAttribute("aria-controls"));
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("shows title, author and a short finish date, linking to the reader", () => {
    render(<CompletedBooks books={[makeBook({ id: "frank-1" })]} />);
    fireEvent.click(screen.getByRole("button"));
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/reader/frank-1");
    expect(link).toHaveTextContent("Frankenstein");
    expect(link).toHaveTextContent("Mary Shelley");
    expect(link).toHaveTextContent("2 Oct 2026");
  });

  it("keeps the order it is given (most recently finished first)", () => {
    render(
      <CompletedBooks
        books={[
          makeBook({ id: "new", title: "Newer", finished_at: "2026-09-30T00:00:00Z" }),
          makeBook({ id: "old", title: "Older", finished_at: "2026-01-05T00:00:00Z" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/reader/new", "/reader/old"]);
    expect(screen.getAllByRole("link")[1]).toHaveTextContent("5 Jan 2026");
  });

  it("remembers the open state per device", () => {
    const { unmount } = render(<CompletedBooks books={[makeBook()]} />);
    fireEvent.click(screen.getByRole("button"));
    expect(window.localStorage.getItem(COMPLETED_OPEN_KEY)).toBe("1");
    unmount();

    render(<CompletedBooks books={[makeBook()]} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("falls back to collapsed, without throwing, when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => render(<CompletedBooks books={[makeBook()]} />)).not.toThrow();
    const toggle = screen.getByRole("button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Toggling still works for this visit even though it cannot be saved. An
    // error thrown inside a React handler surfaces as a window "error" event,
    // not as an exception from fireEvent, so listen for that too.
    const onError = vi.fn((e: Event) => e.preventDefault());
    window.addEventListener("error", onError);
    try {
      expect(() => fireEvent.click(toggle)).not.toThrow();
    } finally {
      window.removeEventListener("error", onError);
    }
    expect(onError).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
