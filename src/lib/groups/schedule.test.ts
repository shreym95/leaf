import { describe, expect, it } from "vitest";
import {
  SCHEDULE_MAX,
  isCalendarDate,
  parseSchedule,
  validateSchedule,
} from "./schedule";

const LEN = 10;
const cp = (chapter_index: unknown, due_on: unknown) => ({ chapter_index, due_on });

describe("isCalendarDate", () => {
  it("accepts real dates, including leap days", () => {
    expect(isCalendarDate("2026-10-17")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2000-02-29")).toBe(true);
    expect(isCalendarDate("0001-01-01")).toBe(true);
  });

  it("rejects impossible days and months", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("1900-02-29")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-00-10")).toBe(false);
    expect(isCalendarDate("2026-01-00")).toBe(false);
  });

  it("rejects other shapes", () => {
    expect(isCalendarDate("0000-01-01")).toBe(false);
    expect(isCalendarDate("2026-1-01")).toBe(false);
    expect(isCalendarDate("2026/01/01")).toBe(false);
    expect(isCalendarDate("2026-01-01T00:00:00Z")).toBe(false);
    expect(isCalendarDate(" 2026-01-01")).toBe(false);
    expect(isCalendarDate(20260101)).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
  });
});

describe("validateSchedule: clearing", () => {
  it("null clears the schedule", () => {
    expect(validateSchedule(null, LEN)).toEqual({ ok: true, schedule: null });
  });

  it("an empty array clears the schedule and is stored as null", () => {
    expect(validateSchedule([], LEN)).toEqual({ ok: true, schedule: null });
  });

  it("undefined and non-array values are rejected", () => {
    expect(validateSchedule(undefined, LEN).ok).toBe(false);
    expect(validateSchedule("cp", LEN).ok).toBe(false);
    expect(validateSchedule({ chapter_index: 0, due_on: "2026-01-01" }, LEN).ok).toBe(false);
  });
});

describe("validateSchedule: accepted schedules", () => {
  it("accepts a single checkpoint", () => {
    expect(validateSchedule([cp(0, "2026-11-01")], LEN)).toEqual({
      ok: true,
      schedule: [{ chapter_index: 0, due_on: "2026-11-01" }],
    });
  });

  it("accepts increasing indices with equal or later dates", () => {
    const res = validateSchedule([cp(2, "2026-11-01"), cp(5, "2026-11-01"), cp(9, "2026-12-31")], LEN);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.schedule).toHaveLength(3);
  });

  it("accepts exactly SCHEDULE_MAX checkpoints", () => {
    const items = Array.from({ length: SCHEDULE_MAX }, (_, i) => cp(i, "2026-11-01"));
    expect(validateSchedule(items, SCHEDULE_MAX).ok).toBe(true);
  });

  it("keeps only the two known keys in the stored shape", () => {
    const res = validateSchedule([{ chapter_index: 1, due_on: "2026-11-01", extra: 1 }], LEN);
    expect(res).toEqual({
      ok: true,
      schedule: [{ chapter_index: 1, due_on: "2026-11-01" }],
    });
  });
});

describe("validateSchedule: rejected schedules", () => {
  it("rejects more than SCHEDULE_MAX checkpoints", () => {
    const items = Array.from({ length: SCHEDULE_MAX + 1 }, (_, i) => cp(i, "2026-11-01"));
    const res = validateSchedule(items, SCHEDULE_MAX + 1);
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.message).toContain(`${SCHEDULE_MAX}`);
  });

  it("rejects an item that is not an object", () => {
    expect(validateSchedule([null], LEN).ok).toBe(false);
    expect(validateSchedule(["0"], LEN).ok).toBe(false);
    expect(validateSchedule([[0, "2026-11-01"]], LEN).ok).toBe(false);
  });

  it("rejects a chapter_index that is not an integer", () => {
    for (const bad of [1.5, "1", null, undefined, NaN, Infinity]) {
      expect(validateSchedule([cp(bad, "2026-11-01")], LEN).ok).toBe(false);
    }
  });

  it("rejects a chapter_index below 0", () => {
    expect(validateSchedule([cp(-1, "2026-11-01")], LEN).ok).toBe(false);
  });

  it("rejects a chapter_index at or past the outline length", () => {
    expect(validateSchedule([cp(LEN - 1, "2026-11-01")], LEN).ok).toBe(true);
    expect(validateSchedule([cp(LEN, "2026-11-01")], LEN).ok).toBe(false);
    expect(validateSchedule([cp(LEN + 5, "2026-11-01")], LEN).ok).toBe(false);
  });

  it("rejects every chapter_index when the outline is empty", () => {
    expect(validateSchedule([cp(0, "2026-11-01")], 0).ok).toBe(false);
  });

  it("rejects a due_on that is not a real calendar date", () => {
    expect(validateSchedule([cp(0, "2026-02-30")], LEN).ok).toBe(false);
    expect(validateSchedule([cp(0, "2026-02-29")], LEN).ok).toBe(false);
    expect(validateSchedule([cp(0, "2026-11-1")], LEN).ok).toBe(false);
    expect(validateSchedule([cp(0, "2026-11-01T00:00:00Z")], LEN).ok).toBe(false);
    expect(validateSchedule([cp(0, undefined)], LEN).ok).toBe(false);
  });

  it("accepts a due_on on a leap day", () => {
    expect(validateSchedule([cp(0, "2028-02-29")], LEN).ok).toBe(true);
  });

  it("rejects chapter indices out of order or repeated", () => {
    expect(validateSchedule([cp(3, "2026-11-01"), cp(2, "2026-12-01")], LEN).ok).toBe(false);
    expect(validateSchedule([cp(3, "2026-11-01"), cp(3, "2026-12-01")], LEN).ok).toBe(false);
  });

  it("rejects a date that goes backwards in chapter order", () => {
    const res = validateSchedule([cp(1, "2026-12-01"), cp(4, "2026-11-30")], LEN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("backwards");
  });

  it("reports the first broken rule only", () => {
    const res = validateSchedule([cp(7, "2026-02-30"), cp(-1, "x")], LEN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("due_on");
  });
});

describe("parseSchedule (tolerant reader)", () => {
  it("returns a clean schedule unchanged", () => {
    expect(parseSchedule([cp(1, "2026-11-01"), cp(4, "2026-12-01")])).toEqual([
      { chapter_index: 1, due_on: "2026-11-01" },
      { chapter_index: 4, due_on: "2026-12-01" },
    ]);
  });

  it("is null for anything that is not an array, and for an empty array", () => {
    expect(parseSchedule(null)).toBeNull();
    expect(parseSchedule(undefined)).toBeNull();
    expect(parseSchedule({})).toBeNull();
    expect(parseSchedule("x")).toBeNull();
    expect(parseSchedule([])).toBeNull();
  });

  it("drops malformed items one by one and keeps the rest", () => {
    expect(
      parseSchedule([
        null,
        cp("1", "2026-11-01"),
        cp(1, "2026-02-30"),
        cp(2, "2026-11-01"),
      ]),
    ).toEqual([{ chapter_index: 2, due_on: "2026-11-01" }]);
  });

  it("drops items that break chapter order or date order", () => {
    expect(
      parseSchedule([cp(3, "2026-11-01"), cp(2, "2026-11-02"), cp(5, "2026-10-01"), cp(6, "2026-11-05")]),
    ).toEqual([
      { chapter_index: 3, due_on: "2026-11-01" },
      { chapter_index: 6, due_on: "2026-11-05" },
    ]);
  });

  it("drops negative and fractional indices", () => {
    expect(parseSchedule([cp(-1, "2026-11-01"), cp(0.5, "2026-11-01"), cp(0, "2026-11-01")])).toEqual([
      { chapter_index: 0, due_on: "2026-11-01" },
    ]);
  });

  it("keeps at most SCHEDULE_MAX items", () => {
    const items = Array.from({ length: SCHEDULE_MAX + 4 }, (_, i) => cp(i, "2026-11-01"));
    expect(parseSchedule(items)).toHaveLength(SCHEDULE_MAX);
  });
});
