import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ScheduleList } from "./ScheduleList";
import type { ScheduleRow } from "./readModel";

afterEach(cleanup);

const rows: ScheduleRow[] = [
  { chapterIndex: 1, label: "Through Chapter 1", dueOn: "2020-01-05", reached: true },
  { chapterIndex: 2, label: "Through Chapter 2", dueOn: "2020-02-10", reached: false },
  { chapterIndex: 3, label: "Through Chapter 3", dueOn: "2099-06-01", reached: false },
];

const localDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );

describe("ScheduleList", () => {
  it("lists each checkpoint as Through <chapter> with its date in the viewer's locale", () => {
    render(<ScheduleList rows={rows} />);
    const list = screen.getByRole("list", { name: "Checkpoints" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Through Chapter 1")).toBeInTheDocument();
    expect(within(items[0]).getByText(localDate("2020-01-05"))).toBeInTheDocument();
    expect(within(items[2]).getByText(localDate("2099-06-01"))).toBeInTheDocument();
  });

  it("marks a checkpoint the viewer has reached, and a past-due one that is not reached", () => {
    render(<ScheduleList rows={rows} />);
    const items = within(screen.getByRole("list", { name: "Checkpoints" })).getAllByRole("listitem");
    expect(within(items[0]).getByText("Reached")).toBeInTheDocument();
    expect(within(items[0]).queryByText("Past due")).toBeNull();
    expect(within(items[1]).getByText("Past due")).toBeInTheDocument();
    expect(within(items[2]).queryByText("Past due")).toBeNull();
    expect(within(items[2]).queryByText("Reached")).toBeNull();
  });

  it("renders each date as a machine-readable time element", () => {
    render(<ScheduleList rows={[rows[0]]} />);
    const time = screen.getByText(localDate("2020-01-05")).closest("time");
    expect(time).toHaveAttribute("datetime", "2020-01-05");
  });
});
