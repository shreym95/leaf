import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { OwnBook, OwnBooksState } from "./useOwnBooks";
import { BookPickerDialog, type BookPickerDialogProps } from "./BookPickerDialog";

afterEach(cleanup);

const middlemarch: OwnBook = {
  id: "b1",
  title: "Middlemarch",
  author: "George Eliot",
  source: "standardebooks",
  sourceRef: null,
};
const zine: OwnBook = { id: "b2", title: "My Zine", author: "", source: "upload", sourceRef: null };

const ready = (list: OwnBook[]): OwnBooksState => ({ kind: "ready", books: list });

function renderPicker(overrides: Partial<BookPickerDialogProps> = {}) {
  const props: BookPickerDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: "Choose your copy",
    books: ready([middlemarch, zine]),
    onPick: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<BookPickerDialog {...props} />);
  return props;
}

describe("BookPickerDialog matchTitle", () => {
  it("lists books that match the group read first, with a tag", () => {
    renderPicker({ books: ready([zine, middlemarch]), matchTitle: "Middlemarch" });

    const list = screen.getByRole("list", { name: "Your books" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("Middlemarch");
    expect(buttons[0]).toHaveTextContent("Matches this book");
    expect(buttons[1]).toHaveTextContent("My Zine");
    expect(buttons[1]).not.toHaveTextContent("Matches this book");
    expect(screen.getAllByText("Matches this book")).toHaveLength(1);
  });

  it("keeps the original order and shows no tag when nothing matches", () => {
    renderPicker({ books: ready([zine, middlemarch]), matchTitle: "Bleak House" });

    const list = screen.getByRole("list", { name: "Your books" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("My Zine");
    expect(buttons[1]).toHaveTextContent("Middlemarch");
    expect(screen.queryByText("Matches this book")).toBeNull();
  });

  it("neither sorts nor tags without matchTitle", () => {
    renderPicker({ books: ready([zine, middlemarch]) });

    const list = screen.getByRole("list", { name: "Your books" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("My Zine");
    expect(buttons[1]).toHaveTextContent("Middlemarch");
    expect(screen.queryByText("Matches this book")).toBeNull();
  });
});
