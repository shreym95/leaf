import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OwnBook, OwnBooksState } from "./useOwnBooks";
import { BookPickerDialog, type BookPickerDialogProps } from "./BookPickerDialog";

vi.mock("./actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actions")>()),
  deleteOwnBook: vi.fn().mockResolvedValue(undefined),
}));

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

function baseProps(overrides: Partial<BookPickerDialogProps> = {}): BookPickerDialogProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    title: "Choose your copy",
    books: ready([middlemarch, zine]),
    onPick: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function epub() {
  return new File(["x"], "zine.epub", { type: "application/epub+zip" });
}

/** Radix dismisses on outside clicks at `click`; body has pointer-events none, so fire it directly. */
async function clickOutside() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent.pointerDown(document.body, { button: 0 });
  fireEvent.pointerUp(document.body, { button: 0 });
  fireEvent.click(document.body);
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("BookPickerDialog close lock while busy", () => {
  it("disables Cancel while an upload is pending", async () => {
    const gate = deferred();
    render(<BookPickerDialog {...baseProps({ onUpload: () => gate.promise })} />);

    await userEvent.upload(screen.getByLabelText("Upload an EPUB file"), epub());

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => gate.resolve());
  });

  it("disables Cancel while a pick is pending", async () => {
    const gate = deferred();
    render(<BookPickerDialog {...baseProps({ onPick: () => gate.promise })} />);

    await userEvent.click(screen.getByRole("button", { name: /My Zine/ }));

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => gate.resolve());
  });

  it("ignores Escape and an outside click while a pick is pending", async () => {
    const gate = deferred();
    const props = baseProps({ onPick: () => gate.promise });
    render(<BookPickerDialog {...props} />);

    await userEvent.click(screen.getByRole("button", { name: /My Zine/ }));

    await userEvent.keyboard("{Escape}");
    await clickOutside();

    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog", { name: "Choose your copy" })).toBeInTheDocument();
    await act(async () => gate.resolve());
  });

  it("does not show an error that arrives after the dialog was closed", async () => {
    const gate = deferred();
    const props = baseProps({ onPick: () => gate.promise });
    const { rerender } = render(<BookPickerDialog {...props} />);

    await userEvent.click(screen.getByRole("button", { name: /My Zine/ }));
    rerender(<BookPickerDialog {...props} open={false} />);
    await act(async () => gate.reject(new Error("Could not link your copy.")));

    rerender(<BookPickerDialog {...props} open />);

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
