import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupNameDialog } from "./GroupNameDialog";

afterEach(cleanup);

function setup(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const onOpenChange = vi.fn();
  render(
    <GroupNameDialog
      open
      onOpenChange={onOpenChange}
      title="New group"
      submitLabel="Create"
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, onOpenChange };
}

describe("GroupNameDialog", () => {
  it("labels the field and offers Create and Cancel", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "New group" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("rejects an empty or whitespace name without submitting", async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText("Name"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("alert")).toHaveTextContent("1 to 60 characters");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a name over 60 characters", async () => {
    const { onSubmit } = setup();
    await userEvent.click(screen.getByLabelText("Name"));
    await userEvent.paste("x".repeat(61));
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("accepts exactly 60 characters and submits the trimmed name", async () => {
    const { onSubmit, onOpenChange } = setup();
    await userEvent.click(screen.getByLabelText("Name"));
    await userEvent.paste(` ${"x".repeat(60)} `);
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit).toHaveBeenCalledWith("x".repeat(60));
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows the server message and stays open when submit fails", async () => {
    const { onOpenChange } = setup(
      vi.fn().mockRejectedValue(new Error("Could not create the group.")),
    );
    await userEvent.type(screen.getByLabelText("Name"), "Club");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not create the group.",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes on Escape", async () => {
    const { onOpenChange } = setup();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
