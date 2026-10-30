import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RemoveCopyDialog } from "./CopyPanel";

afterEach(cleanup);

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderDialog(onConfirm: (deleteBook: boolean) => Promise<void>) {
  const onOpenChange = vi.fn();
  render(<RemoveCopyDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
  return { onOpenChange };
}

/** Radix dismisses on outside clicks at `click`; body has pointer-events none, so fire it directly. */
async function clickOutside() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent.pointerDown(document.body, { button: 0 });
  fireEvent.pointerUp(document.body, { button: 0 });
  fireEvent.click(document.body);
}

async function startRemoveWithDelete() {
  const dialog = screen.getByRole("dialog", { name: "Remove your copy?" });
  await userEvent.click(within(dialog).getByRole("checkbox"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
  return dialog;
}

describe("RemoveCopyDialog while a remove is pending", () => {
  it("disables Cancel, Remove and the checkbox, and says Removing", async () => {
    const gate = deferred();
    renderDialog(() => gate.promise);
    await startRemoveWithDelete();

    const dialog = screen.getByRole("dialog", { name: "Remove your copy?" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Remove" })).toBeDisabled();
    expect(within(dialog).getByRole("checkbox")).toBeDisabled();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Removing…");

    await act(async () => gate.resolve());
  });

  it("ignores Escape while pending", async () => {
    const gate = deferred();
    const { onOpenChange } = renderDialog(() => gate.promise);
    await startRemoveWithDelete();

    await userEvent.keyboard("{Escape}");

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog", { name: "Remove your copy?" })).toBeInTheDocument();
    await act(async () => gate.resolve());
  });

  it("ignores an outside click while pending", async () => {
    const gate = deferred();
    const { onOpenChange } = renderDialog(() => gate.promise);
    await startRemoveWithDelete();

    await clickOutside();

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog", { name: "Remove your copy?" })).toBeInTheDocument();
    await act(async () => gate.resolve());
  });

  it("closes once the remove succeeds", async () => {
    const gate = deferred();
    const { onOpenChange } = renderDialog(() => gate.promise);
    await startRemoveWithDelete();

    await act(async () => gate.resolve());

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("re-enables Cancel and Escape after a failed remove", async () => {
    const gate = deferred();
    const { onOpenChange } = renderDialog(() => gate.promise);
    await startRemoveWithDelete();

    await act(async () => gate.reject(new Error("Couldn't remove your copy. Try again.")));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't remove your copy. Try again.",
    );
    const dialog = screen.getByRole("dialog", { name: "Remove your copy?" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(within(dialog).queryByRole("status")).toBeNull();

    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
