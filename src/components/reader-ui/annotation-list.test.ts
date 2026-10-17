import { describe, expect, it } from "vitest";
import type { Annotation, VisibleReadNote } from "@/lib/types";
import {
  authorName,
  groupByLabel,
  isQuoteTruncated,
  itemPercent,
  itemTitle,
  noteDraft,
  notesForRead,
  sharedGroupNames,
  type AnnotationListItem,
} from "./annotation-list";

function ann(over: Partial<Annotation>): Annotation {
  return {
    id: "a1",
    user_id: "me",
    book_id: "b1",
    kind: "page",
    cfi: "epubcfi(/6/2)",
    quote: null,
    note: null,
    label: "One",
    percent: 0.5,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

function groupNote(over: Partial<VisibleReadNote>): VisibleReadNote {
  return {
    id: "n1",
    read_id: "r1",
    user_id: "ann",
    chapter_index: 0,
    chapter_fraction: 0.2,
    kind: "mark",
    note: null,
    created_at: "2026-10-01T00:00:00Z",
    cfi: null,
    content_sha256: null,
    ...over,
  } as VisibleReadNote;
}

describe("annotation-list helpers", () => {
  it("groups items by label in first-seen order, keeping item order", () => {
    const items = ["One", "One", "Two", "Three", "Three"].map((label, i) => ({
      label,
      i,
    }));
    const groups = groupByLabel(items, (x) => x.label);
    expect(groups.map((g) => g.label)).toEqual(["One", "Two", "Three"]);
    expect(groups[0].items.map((x) => x.i)).toEqual([0, 1]);
    expect(groups[2].items.map((x) => x.i)).toEqual([3, 4]);
  });

  it("filters group notes to one read", () => {
    const notes = [
      groupNote({ id: "a", read_id: "r1" }),
      groupNote({ id: "b", read_id: "r2" }),
    ];
    expect(notesForRead(notes, "r2").map((n) => n.id)).toEqual(["b"]);
  });

  it("names me 'You', a known member by name, anyone else 'Member'", () => {
    const group = { meId: "me", names: { ann: "Ann" } };
    expect(authorName("me", group)).toBe("You");
    expect(authorName("ann", group)).toBe("Ann");
    expect(authorName("zed", group)).toBe("Member");
  });

  it("flags only quotes longer than the 300-character share limit", () => {
    expect(isQuoteTruncated("a".repeat(300))).toBe(false);
    expect(isQuoteTruncated("a".repeat(301))).toBe(true);
    expect(isQuoteTruncated(null)).toBe(false);
  });

  it("counts code points, not UTF-16 units, for the share limit", () => {
    expect(isQuoteTruncated("😀".repeat(300))).toBe(false);
    expect(isQuoteTruncated("😀".repeat(301))).toBe(true);
  });

  it("lists the read names an item is shared with, in read order", () => {
    const reads = [
      { id: "r1", groupName: "Book Club" },
      { id: "r2", groupName: "Night Owls" },
    ];
    expect(sharedGroupNames(["r2"], reads)).toEqual(["Night Owls"]);
    expect(sharedGroupNames(["gone"], reads)).toEqual([]);
  });

  it("maps an empty draft to a removal and trims a saved note", () => {
    expect(noteDraft("   ")).toEqual({ length: 0, overLimit: false, value: null });
    expect(noteDraft("  hi  ")).toEqual({ length: 2, overLimit: false, value: "hi" });
  });

  it("flags a draft over 500 characters and counts code points", () => {
    expect(noteDraft("n".repeat(500)).overLimit).toBe(false);
    expect(noteDraft("n".repeat(501))).toMatchObject({ length: 501, overLimit: true });
    expect(noteDraft("😀".repeat(500)).overLimit).toBe(false);
  });

  it("gives a page percent in whole numbers and null when unknown", () => {
    const item: AnnotationListItem = { source: "mine", annotation: ann({ percent: 0.426 }) };
    const unknown: AnnotationListItem = { source: "mine", annotation: ann({ percent: null }) };
    expect(itemPercent(item)).toBe(43);
    expect(itemPercent(unknown)).toBeNull();
  });

  it("titles a row by its quote, truncated to 40 characters, or Marked page", () => {
    const range: AnnotationListItem = {
      source: "mine",
      annotation: ann({ kind: "range", quote: "x".repeat(50) }),
    };
    const mark: AnnotationListItem = { source: "mine", annotation: ann({}) };
    expect(itemTitle(range)).toBe(`${"x".repeat(40)}…`);
    expect(itemTitle(mark)).toBe("Marked page");
  });
});
