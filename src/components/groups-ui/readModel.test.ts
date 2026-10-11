import { describe, expect, it } from "vitest";
import type { Outline } from "@/lib/groups/types";
import type { GroupMemberName, ReadMilestone, ReadProgress } from "@/lib/types";
import { buildFeed, formatDay, partTitle, placeMembers } from "./readModel";

function entry(
  index: number,
  label: string,
  partIndex: number | null = null,
  partLabel: string | null = null,
) {
  return { index, label, depth: partIndex === null ? 0 : 1, partIndex, partLabel, href: `c${index}` };
}

// Two Parts of two chapters each: points part:0 (ch 0), part:1 (ch 2), half (ch 2), end (ch 3).
const outline: Outline = [
  entry(0, "One", 0, "The Quiet Town"),
  entry(1, "Two", 0, "The Quiet Town"),
  entry(2, "Three", 1, "The Storm Breaks"),
  entry(3, "Four", 1, "The Storm Breaks"),
];

const member = (id: string, name: string | null): GroupMemberName => ({
  user_id: id,
  display_name: name,
  role: "member",
  joined_at: "2026-01-01",
});
const members = [member("a", "Ada"), member("b", "Ben"), member("c", "Cy")];

const ms = (user: string, point: string, at: string): ReadMilestone => ({
  read_id: "r",
  user_id: user,
  point,
  reached_at: at,
});

const prog = (user: string, chapter: number, manual = false): ReadProgress => ({
  read_id: "r",
  user_id: user,
  chapter_index: chapter,
  chapter_fraction: 0,
  percent: 0,
  finished_at: null,
  manual,
  updated_at: "2026-01-01T00:00:00Z",
});

describe("placeMembers", () => {
  it("puts members at their chapter, flags manual, and lists those not started", () => {
    const p = placeMembers(outline, [prog("a", 1), prog("b", 1, true)], members, "a");
    expect(p.byChapter.get(1)).toEqual([
      { userId: "a", name: "You", isSelf: true, manual: false },
      { userId: "b", name: "Ben", isSelf: false, manual: true },
    ]);
    expect(p.notStarted).toEqual(["Cy"]);
  });

  it("clamps a stray chapter index into the outline and ignores non-members", () => {
    const p = placeMembers(outline, [prog("a", 99), prog("zz", 0)], members, "b");
    expect(p.byChapter.get(3)?.map((x) => x.name)).toEqual(["Ada"]);
    expect(p.byChapter.has(0)).toBe(false);
  });
});

describe("buildFeed", () => {
  it("names the first arrival, later arrivals, newest first", () => {
    const feed = buildFeed({
      outline,
      milestones: [
        ms("a", "half", "2026-02-01T10:00:00Z"),
        ms("b", "half", "2026-02-03T10:00:00Z"),
      ],
      members,
      viewerId: "c",
    });
    expect(feed.map((f) => f.text)).toEqual([
      "Ben reached Halfway",
      "First to Halfway: Ada",
    ]);
  });

  it("adds Everyone reached when every current member has the point", () => {
    const feed = buildFeed({
      outline,
      milestones: [
        ms("a", "end", "2026-02-01T10:00:00Z"),
        ms("b", "end", "2026-02-02T10:00:00Z"),
        ms("c", "end", "2026-02-03T10:00:00Z"),
      ],
      members,
      viewerId: "a",
    });
    expect(feed.map((f) => f.text)).toEqual([
      "Everyone reached The end",
      "Cy reached The end",
      "Ben reached The end",
      "First to The end: You",
    ]);
  });

  it("ignores arrivals of people who are no longer members", () => {
    const feed = buildFeed({
      outline,
      milestones: [
        ms("gone", "half", "2026-02-01T10:00:00Z"),
        ms("a", "half", "2026-02-02T10:00:00Z"),
      ],
      members: [member("a", "Ada"), member("b", "Ben")],
      viewerId: "b",
    });
    expect(feed.map((f) => f.text)).toEqual(["First to Halfway: Ada"]);
  });

  it("masks the title of a Part the viewer has not reached", () => {
    const rows = [
      ms("a", "part:0", "2026-02-01T10:00:00Z"),
      ms("a", "part:1", "2026-02-02T10:00:00Z"),
      ms("b", "part:0", "2026-02-03T10:00:00Z"),
    ];
    const text = (viewerId: string) =>
      buildFeed({ outline, milestones: rows, members, viewerId }).map((f) => f.text);

    // Ben has reached Part 1 only: Part 2 is a number, Part 1 keeps its title.
    expect(text("b")).toEqual([
      "You reached The Quiet Town",
      "First to Part 2: Ada",
      "First to The Quiet Town: Ada",
    ]);
    expect(text("b").join("\n")).not.toContain("Storm");
    // Ada has reached both.
    expect(text("a").join("\n")).toContain("First to The Storm Breaks: You");
    // Cy has reached neither.
    expect(text("c").join("\n")).not.toMatch(/Quiet|Storm/);
    expect(text("c")).toContain("First to Part 2: Ada");
  });

  it("never reports pace", () => {
    const feed = buildFeed({
      outline,
      milestones: [
        ms("a", "half", "2026-02-01T10:00:00Z"),
        ms("b", "half", "2026-02-09T10:00:00Z"),
      ],
      members,
      viewerId: "a",
    });
    expect(feed.map((f) => f.text).join(" ")).not.toMatch(/day|hour|faster|slower|ahead/i);
  });
});

describe("partTitle and formatDay", () => {
  it("uses the number when unreached", () => {
    expect(partTitle(new Set(), 2, "Secret")).toBe("Part 3");
    expect(partTitle(new Set(["part:2"]), 2, "Secret")).toBe("Secret");
  });

  it("formats in a fixed locale and zone", () => {
    expect(formatDay("2026-02-03T23:30:00Z")).toBe("Feb 3, 2026");
  });
});
