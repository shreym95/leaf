import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotesList } from "./NotesList";
import type { NoteGroup } from "./readModel";

afterEach(cleanup);

const groups: NoteGroup[] = [
  {
    chapterIndex: 1,
    label: "Chapter 1",
    items: [
      { id: "n1", kind: "mark", text: null, name: "You", isSelf: true },
      { id: "n2", kind: "note", text: "Who is this?", name: "Ben", isSelf: false },
    ],
  },
  {
    chapterIndex: 3,
    label: "Chapter 3",
    items: [{ id: "n3", kind: "note", text: "Mine", name: "You", isSelf: true }],
  },
];

describe("NotesList", () => {
  it("says so when there are no marks or notes", () => {
    render(<NotesList groups={[]} onDelete={vi.fn()} />);
    expect(screen.getByText("No marks or notes yet.")).toBeInTheDocument();
  });

  it("shows each chapter heading, the author, and the mark or note text", () => {
    render(<NotesList groups={groups} onDelete={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Chapter 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chapter 3" })).toBeInTheDocument();
    expect(screen.getByText("marked this page")).toBeInTheDocument();
    expect(screen.getByText("Who is this?")).toBeInTheDocument();
    expect(screen.getByText("Ben")).toBeInTheDocument();
  });

  it("offers Delete only on the viewer's own items", () => {
    render(<NotesList groups={groups} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Delete your mark in Chapter 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete your note in Chapter 3" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("deletes the chosen item through onDelete", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<NotesList groups={groups} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete your mark in Chapter 1" }));
    expect(onDelete).toHaveBeenCalledWith("n1");
  });

  it("shows the error and keeps the item when deleting fails", async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error("nope"));
    render(<NotesList groups={groups} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete your note in Chapter 3" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't delete. Try again.");
    const chapter3 = screen.getByRole("heading", { name: "Chapter 3" }).parentElement!;
    expect(within(chapter3).getByText("Mine")).toBeInTheDocument();
  });
});
