import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Outline } from "@/lib/groups/types";

const h = vi.hoisted(() => ({
  setReadSchedule: vi.fn(),
}));

vi.mock("./actions", () => ({
  setReadSchedule: (...args: unknown[]) => h.setReadSchedule(...args),
}));

import { ScheduleDialog, type ScheduleDialogProps } from "./ScheduleDialog";

const outline: Outline = [
  { index: 0, label: "Preface", depth: 0, partIndex: null, partLabel: null, href: "a" },
  { index: 1, label: "Chapter 1", depth: 1, partIndex: 0, partLabel: "Part", href: "b" },
  { index: 2, label: "Chapter 2", depth: 1, partIndex: 0, partLabel: "Part", href: "c" },
  { index: 3, label: "Chapter 3", depth: 1, partIndex: 0, partLabel: "Part", href: "d" },
];

function renderDialog(over: Partial<ScheduleDialogProps> = {}) {
  const props: ScheduleDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    groupId: "g1",
    readId: "r1",
    outline,
    schedule: null,
    onSaved: vi.fn(),
    ...over,
  };
  render(<ScheduleDialog {...props} />);
  return props;
}

beforeEach(() => {
  h.setReadSchedule.mockReset();
  h.setReadSchedule.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("ScheduleDialog", () => {
  it("starts empty when no schedule is set and says that saving clears it", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Reading schedule" })).toBeInTheDocument();
    expect(screen.getByText(/Saving with none clears the schedule/)).toBeInTheDocument();
  });

  it("adds a row, then saves the chapter and date through setReadSchedule", async () => {
    const props = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Add checkpoint" }));
    await userEvent.selectOptions(screen.getByLabelText("Chapter for checkpoint 1"), "2");
    fireEvent.change(screen.getByLabelText("Due date for checkpoint 1"), {
      target: { value: "2026-03-01" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(h.setReadSchedule).toHaveBeenCalledWith("g1", "r1", [
      { chapter_index: 2, due_on: "2026-03-01" },
    ]);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("refuses to save a row with no chapter or no date", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Add checkpoint" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Each checkpoint needs a chapter and a date.",
    );
    expect(h.setReadSchedule).not.toHaveBeenCalled();
  });

  it("runs validateSchedule before sending and shows its message", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Add checkpoint" }));
    await userEvent.click(screen.getByRole("button", { name: "Add checkpoint" }));
    await userEvent.selectOptions(screen.getByLabelText("Chapter for checkpoint 1"), "3");
    await userEvent.selectOptions(screen.getByLabelText("Chapter for checkpoint 2"), "1");
    fireEvent.change(screen.getByLabelText("Due date for checkpoint 1"), { target: { value: "2026-03-10" } });
    fireEvent.change(screen.getByLabelText("Due date for checkpoint 2"), { target: { value: "2026-03-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Checkpoints must go in chapter order, with no repeats.",
    );
    expect(h.setReadSchedule).not.toHaveBeenCalled();
  });

  it("shows the server's message when the save is refused", async () => {
    h.setReadSchedule.mockRejectedValue(new Error("Each due_on must be a real date as YYYY-MM-DD."));
    renderDialog({
      schedule: [{ chapter_index: 1, due_on: "2026-03-01" }],
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Each due_on must be a real date as YYYY-MM-DD.",
    );
  });

  it("shows the plain save error when the request fails without a message", async () => {
    h.setReadSchedule.mockRejectedValue(new Error("Couldn't save. Try again."));
    const props = renderDialog({ schedule: [{ chapter_index: 1, due_on: "2026-03-01" }] });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save. Try again.");
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("offers Clear schedule only when one is set, and clears with null", async () => {
    const props = renderDialog({ schedule: [{ chapter_index: 1, due_on: "2026-03-01" }] });
    await userEvent.click(screen.getByRole("button", { name: "Clear schedule" }));
    await vi.waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(h.setReadSchedule).toHaveBeenCalledWith("g1", "r1", null);
  });

  it("does not offer Clear schedule when nothing is set", () => {
    renderDialog();
    expect(screen.queryByRole("button", { name: "Clear schedule" })).toBeNull();
  });

  it("lists the saved checkpoints and removes one row", async () => {
    renderDialog({
      schedule: [
        { chapter_index: 1, due_on: "2026-03-01" },
        { chapter_index: 2, due_on: "2026-03-08" },
      ],
    });
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Remove checkpoint 1" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByLabelText("Due date for checkpoint 1")).toHaveValue("2026-03-08");
  });

  it("caps the list at 12 checkpoints", async () => {
    renderDialog({ schedule: null });
    for (let i = 0; i < 12; i++) {
      await userEvent.click(screen.getByRole("button", { name: "Add checkpoint" }));
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Add checkpoint" })).toBeDisabled();
    expect(screen.getByText("Up to 12 checkpoints.")).toBeInTheDocument();
  });
});
