import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OwnBook, OwnBooksState } from "./useOwnBooks";
import { BookPickerDialog, type BookPickerDialogProps } from "./BookPickerDialog";

afterEach(cleanup);

const books: OwnBook[] = [
  { id: "b1", title: "Middlemarch", author: "George Eliot", source: "standardebooks", sourceRef: null },
  { id: "b2", title: "My Zine", author: "", source: "upload", sourceRef: null },
];

const ready = (list: OwnBook[] = books): OwnBooksState => ({ kind: "ready", books: list });

function renderPicker(overrides: Partial<BookPickerDialogProps> = {}) {
  const props: BookPickerDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: "Choose your copy",
    books: ready(),
    onPick: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<BookPickerDialog {...props} />);
  return props;
}

function epub(name = "zine.epub") {
  return new File(["x"], name, { type: "application/epub+zip" });
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText("Upload an EPUB file") as HTMLInputElement;
}

describe("BookPickerDialog upload", () => {
  it("shows no upload option when onUpload is absent", () => {
    renderPicker();
    expect(screen.queryByRole("button", { name: "Upload an EPUB" })).toBeNull();
    expect(screen.queryByLabelText("Upload an EPUB file")).toBeNull();
  });

  it("uploads the chosen file, then closes on success", async () => {
    let finish!: () => void;
    const onUpload = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const props = renderPicker({ onUpload });

    const file = epub();
    await userEvent.upload(fileInput(), file);

    expect(onUpload).toHaveBeenCalledWith(file);
    expect(screen.getByRole("status")).toHaveTextContent("Uploading…");
    expect(screen.getByRole("button", { name: "Upload an EPUB" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Middlemarch/ })).toBeDisabled();

    finish();
    await vi.waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it("shows the error message and stays open when the upload fails", async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error("That doesn't look like an EPUB file."));
    const props = renderPicker({ onUpload });

    await userEvent.upload(fileInput(), epub());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That doesn't look like an EPUB file.",
    );
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.queryByText("Uploading…")).toBeNull();
    expect(screen.getByRole("button", { name: /Middlemarch/ })).toBeEnabled();
  });
});

describe("BookPickerDialog excludeBookId", () => {
  it("hides the excluded book from the list", () => {
    renderPicker({ excludeBookId: "b1" });
    expect(screen.queryByRole("button", { name: /Middlemarch/ })).toBeNull();
    expect(screen.getByRole("button", { name: /My Zine/ })).toBeInTheDocument();
  });

  it("says so when the excluded book is the only one", () => {
    renderPicker({ books: ready([books[0]]), excludeBookId: "b1" });
    expect(screen.getByText("No other books in your library.")).toBeInTheDocument();
  });
});
