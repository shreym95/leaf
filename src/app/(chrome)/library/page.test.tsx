import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { LibraryBook } from "@/lib/db/books";

const listBooks = vi.fn();
const countArchivedBooks = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/db", () => ({
  listBooks: (...args: unknown[]) => listBooks(...args),
  countArchivedBooks: (...args: unknown[]) => countArchivedBooks(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/components/analytics/ScreenView", () => ({ ScreenView: () => null }));

import LibraryPage from "./page";

function makeBook(overrides: Partial<LibraryBook> = {}): LibraryBook {
  return {
    id: "b1",
    user_id: "u1",
    title: "Title",
    author: "Author",
    source: "standardebooks",
    source_ref: null,
    storage_path: null,
    cover_path: null,
    cover_url: null,
    archived_at: null,
    added_at: "2026-01-01T00:00:00Z",
    status: "reading",
    finished_at: null,
    percent: 0.3,
    lastReadAt: "2026-09-01T00:00:00Z",
    coverUrl: null,
    ...overrides,
  };
}

async function renderPage(hidden?: string) {
  const ui = await LibraryPage({
    searchParams: Promise.resolve(hidden ? { hidden } : {}),
  });
  return render(ui);
}

beforeEach(() => {
  window.localStorage.clear();
  listBooks.mockReset();
  countArchivedBooks.mockReset();
  countArchivedBooks.mockResolvedValue(0);
});

describe("library page — Completed Books", () => {
  it("renders no Completed Books section when nothing is finished", async () => {
    listBooks.mockResolvedValue([makeBook({ id: "a", title: "Alpha" })]);
    await renderPage();
    expect(screen.queryByText(/completed books/i)).toBeNull();
  });

  it("takes finished books out of the shelf grid and into the collapsed section", async () => {
    listBooks.mockResolvedValue([
      makeBook({ id: "open", title: "Still Open", lastReadAt: "2026-09-05T00:00:00Z" }),
      makeBook({ id: "other", title: "Other", lastReadAt: "2026-08-01T00:00:00Z" }),
      makeBook({
        id: "done",
        title: "Done Book",
        status: "finished",
        finished_at: "2026-09-20T00:00:00Z",
        percent: 1,
      }),
    ]);
    await renderPage();

    // Not in the shelf: no card carries it, and the shelf still has the others.
    expect(screen.queryByRole("heading", { name: "Done Book" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Other" })).toBeInTheDocument();

    // The section is there, collapsed, with the count.
    const toggle = screen.getByRole("button", { name: /completed books/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("1");

    // Expanding reveals it as a row linking to the reader.
    fireEvent.click(toggle);
    expect(screen.getByRole("link", { name: /Done Book/ })).toHaveAttribute(
      "href",
      "/reader/done",
    );
  });

  it("keeps the shelf standing alone when every book is completed", async () => {
    listBooks.mockResolvedValue([
      makeBook({ id: "a", status: "finished", finished_at: "2026-09-01T00:00:00Z" }),
    ]);
    await renderPage();
    expect(screen.queryByLabelText("Continue reading")).toBeNull();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /completed books/i })).toBeInTheDocument();
  });

  it("does not show Completed Books in the hidden view, which keeps archived books as they are", async () => {
    listBooks.mockResolvedValue([
      makeBook({
        id: "arch",
        title: "Archived And Done",
        status: "finished",
        finished_at: "2026-09-01T00:00:00Z",
        archived_at: "2026-09-10T00:00:00Z",
      }),
    ]);
    await renderPage("1");
    expect(screen.queryByText(/completed books/i)).toBeNull();
    // Still on the hidden shelf as a normal card.
    expect(screen.getByRole("heading", { name: "Archived And Done" })).toBeInTheDocument();
    expect(listBooks).toHaveBeenCalledWith("u1", { archived: true });
  });

  it("never lists an archived finished book in Completed Books, even if one reaches the page", async () => {
    listBooks.mockResolvedValue([
      makeBook({ id: "a", title: "Active" }),
      makeBook({
        id: "arch",
        title: "Archived And Done",
        status: "finished",
        finished_at: "2026-09-01T00:00:00Z",
        archived_at: "2026-09-10T00:00:00Z",
      }),
    ]);
    await renderPage();
    expect(screen.queryByText(/completed books/i)).toBeNull();
  });
});
