// Scheduled checkpoints as milestone points. The reached rule mirrors
// record_read_milestones() in supabase/migrations/0010_read_notes.sql:
//   chapter_index > ci OR (chapter_index = ci AND chapter_fraction >= 0.98) OR finished
// with `finished` reaching checkpoints (and `end`) but not part or half.

import { describe, expect, it } from "vitest";
import {
  END_FRACTION_THRESHOLD,
  buildOutline,
  checkpointLabel,
  milestonePoints,
  pointsReached,
} from "./outline";
import type { TocInput } from "./types";

const flat = (n: number): TocInput[] =>
  Array.from({ length: n }, (_, i) => ({
    href: `ch${i + 1}.xhtml`,
    label: `Chapter ${i + 1}`,
  }));

const middlemarch: TocInput[] = [
  { href: "titlepage.xhtml", label: "Title Page" },
  {
    href: "book-1.xhtml",
    label: "Book I: Miss Brooke",
    subitems: [
      { href: "ch-1.xhtml", label: "Chapter 1" },
      { href: "ch-2.xhtml", label: "Chapter 2" },
    ],
  },
  {
    href: "book-2.xhtml",
    label: "Book II: Old and Young",
    subitems: [
      { href: "ch-3.xhtml", label: "Chapter 3" },
      { href: "ch-4.xhtml", label: "Chapter 4" },
    ],
  },
  { href: "finale.xhtml", label: "Finale" },
];

const cp = (chapter_index: number, due_on = "2026-11-01") => ({ chapter_index, due_on });

describe("milestonePoints with a schedule", () => {
  it("is identical to the no-schedule result when the schedule is null or empty", () => {
    const o = buildOutline(middlemarch);
    expect(milestonePoints(o, null)).toEqual(milestonePoints(o));
    expect(milestonePoints(o, [])).toEqual(milestonePoints(o));
    expect(milestonePoints(o, undefined)).toEqual(milestonePoints(o));
  });

  it("adds one checkpoint point per checkpoint, at the threshold, labelled by its chapter", () => {
    const o = buildOutline(middlemarch);
    const pts = milestonePoints(o, [cp(2)]);
    const checkpoint = pts.find((p) => p.point === "checkpoint:2");
    expect(checkpoint).toMatchObject({
      point: "checkpoint:2",
      chapterIndex: 2,
      chapterFraction: END_FRACTION_THRESHOLD,
      label: "Chapter 2",
    });
  });

  it("keeps checkpoints in reading order among the other points", () => {
    const o = buildOutline(middlemarch); // 6 chapters: part:0@1, part:1@3, half@3, end@5
    expect(milestonePoints(o, [cp(4), cp(2)]).map((p) => p.point)).toEqual([
      "part:0",
      "checkpoint:2",
      "part:1",
      "half",
      "checkpoint:4",
      "end",
    ]);
  });

  it("ignores a checkpoint whose chapter is outside the outline", () => {
    const o = buildOutline(flat(4));
    expect(milestonePoints(o, [cp(4), cp(-1)]).map((p) => p.point)).toEqual([
      "half",
      "end",
    ]);
  });

  it("returns nothing for an empty outline, schedule or not", () => {
    expect(milestonePoints([], [cp(0)])).toEqual([]);
  });
});

describe("checkpointLabel", () => {
  it("names a checkpoint by the chapter it is due at", () => {
    expect(checkpointLabel("Chapter 3")).toBe("Through Chapter 3");
  });
});

describe("pointsReached with a schedule", () => {
  const o = buildOutline(flat(6));

  it("does not reach a checkpoint before its chapter", () => {
    expect(pointsReached(o, { chapterIndex: 1, chapterFraction: 1 }, [cp(2)])).not.toContain(
      "checkpoint:2",
    );
  });

  it("reaches a checkpoint at exactly the 0.98 boundary of its chapter", () => {
    expect(
      pointsReached(o, { chapterIndex: 2, chapterFraction: END_FRACTION_THRESHOLD }, [cp(2)]),
    ).toContain("checkpoint:2");
  });

  it("does not reach it just below the 0.98 boundary", () => {
    expect(
      pointsReached(o, { chapterIndex: 2, chapterFraction: 0.979 }, [cp(2)]),
    ).not.toContain("checkpoint:2");
    expect(
      pointsReached(o, { chapterIndex: 2, chapterFraction: END_FRACTION_THRESHOLD - 0.0001 }, [cp(2)]),
    ).not.toContain("checkpoint:2");
  });

  it("reaches it from the start of the next chapter", () => {
    expect(pointsReached(o, { chapterIndex: 3, chapterFraction: 0 }, [cp(2)])).toContain(
      "checkpoint:2",
    );
  });

  it("is reached by a position past the outline's end", () => {
    expect(pointsReached(o, { chapterIndex: 99, chapterFraction: 0 }, [cp(2)])).toContain(
      "checkpoint:2",
    );
  });

  it("is reached by finishing the read, wherever the position is", () => {
    expect(pointsReached(o, { chapterIndex: 0, chapterFraction: 0 }, [cp(4)], true)).toContain(
      "checkpoint:4",
    );
    expect(pointsReached(o, { chapterIndex: -1, chapterFraction: 0 }, [cp(4)], true)).toContain(
      "checkpoint:4",
    );
  });

  it("finished reaches end but not part or half", () => {
    const parts = buildOutline(middlemarch);
    const reached = pointsReached(parts, { chapterIndex: 0, chapterFraction: 0 }, null, true);
    expect(reached).toEqual(["end"]);
  });

  it("unfinished reaches nothing the position has not reached, schedule or not", () => {
    expect(pointsReached(o, { chapterIndex: 0, chapterFraction: 0.5 }, [cp(4)], false)).toEqual([]);
  });

  it("keeps the no-schedule behaviour when called without the new arguments", () => {
    expect(pointsReached(o, { chapterIndex: 3, chapterFraction: 0 })).toEqual(["half"]);
  });

  it("reports checkpoints in reading order", () => {
    expect(
      pointsReached(o, { chapterIndex: 5, chapterFraction: 1 }, [cp(1), cp(3)]),
    ).toEqual(["checkpoint:1", "half", "checkpoint:3", "end"]);
  });
});
