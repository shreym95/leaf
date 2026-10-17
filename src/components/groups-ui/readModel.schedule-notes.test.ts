import { describe, expect, it } from "vitest";
import type { Outline } from "@/lib/groups/types";
import type { GroupMemberName, ReadMilestone, VisibleReadNote } from "@/lib/types";
import {
  buildFeed,
  groupNotes,
  isPastDue,
  scheduleRows,
  todayIso,
} from "./readModel";

const outline: Outline = [
  { index: 0, label: "Preface", depth: 0, partIndex: null, partLabel: null, href: "a" },
  { index: 1, label: "Chapter 1", depth: 1, partIndex: 0, partLabel: "The Quiet Town", href: "b" },
  { index: 2, label: "Chapter 2", depth: 1, partIndex: 0, partLabel: "The Quiet Town", href: "c" },
  { index: 3, label: "Chapter 3", depth: 1, partIndex: 1, partLabel: "The Storm Breaks", href: "d" },
];

const members: GroupMemberName[] = [
  { user_id: "u1", display_name: "Ada", role: "owner", joined_at: "2026-01-01" },
  { user_id: "u2", display_name: "Ben", role: "member", joined_at: "2026-01-02" },
];

const schedule = [
  { chapter_index: 1, due_on: "2026-03-01" },
  { chapter_index: 3, due_on: "2026-03-20" },
];

function ms(user_id: string, point: string, reached_at: string): ReadMilestone {
  return { read_id: "r1", user_id, point, reached_at };
}

describe("buildFeed with checkpoints", () => {
  it("names a checkpoint the viewer has not reached by its position only", () => {
    const feed = buildFeed({
      outline,
      milestones: [ms("u2", "checkpoint:1", "2026-02-01T09:00:00Z")],
      members,
      viewerId: "u1",
      schedule,
    });
    const texts = feed.map((f) => f.text);
    expect(texts).toContain("First to Checkpoint 1: Ben");
    expect(texts.join(" ")).not.toContain("Chapter 1");
  });

  it("names a checkpoint with its chapter once the viewer has reached it", () => {
    const feed = buildFeed({
      outline,
      milestones: [
        ms("u1", "checkpoint:1", "2026-02-01T09:00:00Z"),
        ms("u2", "checkpoint:1", "2026-02-02T09:00:00Z"),
      ],
      members,
      viewerId: "u1",
      schedule,
    });
    const texts = feed.map((f) => f.text);
    expect(texts).toContain("First to Through Chapter 1: You");
    expect(texts).toContain("Ben reached Through Chapter 1");
    expect(texts).toContain("Everyone reached Through Chapter 1");
  });

  it("ignores checkpoint points that are no longer in the schedule", () => {
    const feed = buildFeed({
      outline,
      milestones: [ms("u2", "checkpoint:2", "2026-02-01T09:00:00Z")],
      members,
      viewerId: "u1",
      schedule,
    });
    expect(feed).toEqual([]);
  });

  it("never crashes on unknown or malformed point strings", () => {
    const junk = [
      "checkpoint:x",
      "checkpoint:99",
      "checkpoint:",
      "part:abc",
      "part:9",
      "bogus",
      "",
    ];
    const feed = buildFeed({
      outline,
      milestones: [
        ...junk.map((p) => ms("u2", p, "2026-02-01T09:00:00Z")),
        ms("u2", "half", "2026-02-02T09:00:00Z"),
      ],
      members,
      viewerId: "u1",
      schedule: null,
    });
    expect(feed.map((f) => f.text)).toEqual(["First to Halfway: Ben"]);
  });

  it("keeps the feed unchanged when no schedule is passed", () => {
    const feed = buildFeed({
      outline,
      milestones: [ms("u2", "end", "2026-02-02T09:00:00Z")],
      members,
      viewerId: "u1",
    });
    expect(feed.map((f) => f.text)).toEqual(["First to The end: Ben"]);
  });
});

describe("scheduleRows", () => {
  it("labels each checkpoint with its chapter and marks the viewer's reached ones", () => {
    const rows = scheduleRows(outline, schedule, new Set(["checkpoint:1"]));
    expect(rows).toEqual([
      { chapterIndex: 1, label: "Through Chapter 1", dueOn: "2026-03-01", reached: true },
      { chapterIndex: 3, label: "Through Chapter 3", dueOn: "2026-03-20", reached: false },
    ]);
  });

  it("drops a checkpoint whose chapter is outside the outline", () => {
    const rows = scheduleRows(outline, [{ chapter_index: 40, due_on: "2026-03-01" }], new Set());
    expect(rows).toEqual([]);
  });
});

describe("date helpers", () => {
  it("formats the local calendar date as YYYY-MM-DD", () => {
    expect(todayIso(new Date(2026, 9, 7, 23, 30))).toBe("2026-10-07");
  });

  it("treats only earlier dates as past due", () => {
    expect(isPastDue("2026-10-06", "2026-10-07")).toBe(true);
    expect(isPastDue("2026-10-07", "2026-10-07")).toBe(false);
    expect(isPastDue("2026-10-08", "2026-10-07")).toBe(false);
  });
});

describe("groupNotes", () => {
  const notes: VisibleReadNote[] = [
    {
      id: "n3", read_id: "r1", user_id: "u2", chapter_index: 3, chapter_fraction: 0.1,
      kind: "note", note: "Good line", cfi: null, content_sha256: null, created_at: "2026-02-03T00:00:00Z",
    },
    {
      id: "n1", read_id: "r1", user_id: "u1", chapter_index: 1, chapter_fraction: 0.5,
      kind: "mark", note: null, cfi: null, content_sha256: null, created_at: "2026-02-01T00:00:00Z",
    },
    {
      id: "n2", read_id: "r1", user_id: "u2", chapter_index: 1, chapter_fraction: 0.2,
      kind: "note", note: "Who is this?", cfi: null, content_sha256: null, created_at: "2026-02-02T00:00:00Z",
    },
    {
      id: "n9", read_id: "r1", user_id: "u9", chapter_index: 0, chapter_fraction: 0,
      kind: "mark", note: null, cfi: null, content_sha256: null, created_at: "2026-02-04T00:00:00Z",
    },
  ];

  it("groups by chapter in outline order, skipping chapters with no notes", () => {
    const groups = groupNotes(outline, notes, members, "u1");
    expect(groups.map((g) => g.label)).toEqual(["Preface", "Chapter 1", "Chapter 3"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["n1", "n2"]);
  });

  it("names the viewer as You, other members by name, and unknown authors as Someone", () => {
    const groups = groupNotes(outline, notes, members, "u1");
    const [preface, chapter1] = groups;
    expect(chapter1.items[0]).toMatchObject({ name: "You", isSelf: true, kind: "mark", text: null });
    expect(chapter1.items[1]).toMatchObject({ name: "Ben", isSelf: false, text: "Who is this?" });
    expect(preface.items[0].name).toBe("Someone");
  });

  it("drops highlights, which are not written in this version", () => {
    const groups = groupNotes(
      outline,
      [{ ...notes[0], id: "h1", kind: "highlight", note: null }],
      members,
      "u1",
    );
    expect(groups).toEqual([]);
  });
});
