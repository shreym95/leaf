import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotesList } from "./NotesList";
import type { NoteGroup } from "./readModel";

afterEach(cleanup);

const groups: NoteGroup[] = [
  {
    chapterIndex: 2,
    label: "Chapter 2",
    items: [
      {
        id: "h-mine",
        kind: "highlight",
        text: "Keep this",
        quote: "The rain did not stop.",
        name: "You",
        isSelf: true,
      },
      {
        id: "h-ben",
        kind: "highlight",
        text: null,
        quote: "A quiet line from Ben.",
        name: "Ben",
        isSelf: false,
      },
    ],
  },
];

describe("NotesList highlights", () => {
  it("shows the shared quote and the note under it", () => {
    render(<NotesList groups={groups} onDelete={vi.fn()} />);
    expect(screen.getByText("The rain did not stop.")).toBeInTheDocument();
    expect(screen.getByText("Keep this")).toBeInTheDocument();
    expect(screen.getByText("A quiet line from Ben.")).toBeInTheDocument();
  });

  it("clamps the quote to two lines", () => {
    render(<NotesList groups={groups} onDelete={vi.fn()} />);
    expect(screen.getByText("The rain did not stop.")).toHaveClass("line-clamp-2");
  });

  it("labels the viewer's shared highlight Remove from group, and offers nothing on others'", () => {
    render(<NotesList groups={groups} onDelete={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Remove from group: your highlight in Chapter 2" }),
    ).toHaveTextContent("Remove from group");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("removes the group copy through onDelete with the highlight's id", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<NotesList groups={groups} onDelete={onDelete} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove from group: your highlight in Chapter 2" }),
    );
    expect(onDelete).toHaveBeenCalledWith("h-mine");
  });
});
