import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  books: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: h.refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        order: () => h.books(),
      };
      return q;
    },
  }),
}));

import { GroupScreen } from "./GroupScreen";

const rows = [
  { id: "b1", title: "Middlemarch", author: "George Eliot", source: "standardebooks", source_ref: "george-eliot/middlemarch" },
  { id: "b2", title: "My Zine", author: null, source: "upload", source_ref: null },
];

let fetchMock: ReturnType<typeof vi.fn>;

function renderScreen() {
  return render(
    <GroupScreen
      groupId="g1"
      name="Tuesday club"
      currentUserId="u2"
      members={[
        { user_id: "u1", display_name: "Ada", role: "owner", joined_at: "2026-01-01" },
        { user_id: "u2", display_name: "Ben", role: "member", joined_at: "2026-01-02" },
      ]}
      reads={[]}
    />,
  );
}

beforeEach(() => {
  h.refresh.mockReset();
  h.books.mockReset();
  h.books.mockResolvedValue({ data: rows, error: null });
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ read: { id: "r9", groupId: "g1" }, linked: 1, pending: 0 }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GroupScreen add a book", () => {
  it("does not load the library until the dialog opens", () => {
    renderScreen();
    expect(h.books).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add a book" })).toBeInTheDocument();
  });

  it("lists the member's books with title and author", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Add a book" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a book" });
    expect(await within(dialog).findByText("Middlemarch")).toBeInTheDocument();
    expect(within(dialog).getByText("George Eliot")).toBeInTheDocument();
    expect(within(dialog).getByText("My Zine")).toBeInTheDocument();
  });

  it("posts a catalog book with its source reference, then refreshes and closes", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Add a book" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: /Middlemarch/ }));
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/groups/g1/reads");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      title: "Middlemarch",
      author: "George Eliot",
      source: "standardebooks",
      sourceRef: "george-eliot/middlemarch",
      bookId: "b1",
    });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("posts an uploaded book without a source reference", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Add a book" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: /My Zine/ }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      title: "My Zine",
      author: "",
      source: "upload",
      bookId: "b2",
    });
  });

  it("shows the route's error line and stays open on failure", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "This book has no table of contents." }),
    });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Add a book" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: /Middlemarch/ }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This book has no table of contents.",
    );
    expect(h.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Add a book" }));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("says so when the library is empty and when it cannot load", async () => {
    h.books.mockResolvedValue({ data: [], error: null });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Add a book" }));
    expect(await screen.findByText("Your library is empty.")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    h.books.mockResolvedValue({ data: null, error: new Error("nope") });
    await userEvent.click(screen.getByRole("button", { name: "Add a book" }));
    expect(await screen.findByText("Could not load your books.")).toBeInTheDocument();
  });
});
