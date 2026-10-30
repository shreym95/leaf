import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RemoveCopyDialog } from "./CopyPanel";

afterEach(cleanup);

describe("RemoveCopyDialog after a successful remove", () => {
  it("unticks 'Also delete this book' when reopened", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <RemoveCopyDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />,
    );

    const first = screen.getByRole("dialog", { name: "Remove your copy?" });
    await userEvent.click(within(first).getByRole("checkbox"));
    expect(within(first).getByRole("checkbox")).toBeChecked();
    await userEvent.click(within(first).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).toHaveBeenCalledWith(true);

    rerender(
      <RemoveCopyDialog open={false} onOpenChange={onOpenChange} onConfirm={onConfirm} />,
    );
    rerender(<RemoveCopyDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    const reopened = screen.getByRole("dialog", { name: "Remove your copy?" });
    expect(within(reopened).getByRole("checkbox")).not.toBeChecked();
  });
});
