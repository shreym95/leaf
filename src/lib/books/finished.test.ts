import { describe, expect, it } from "vitest";
import type { Book } from "@/lib/types";
import { isBookFinished, partitionCompleted } from "./finished";

describe("isBookFinished", () => {
  it("is true only for status 'finished'", () => {
    expect(isBookFinished({ status: "finished" })).toBe(true);
    expect(isBookFinished({ status: "reading" })).toBe(false);
  });

  it("ignores reading progress, even at 100%", () => {
    // A book marked unread at 99.6% (or sitting at 100%) is not finished.
    expect(isBookFinished({ status: "reading", percent: 0.996 } as never)).toBe(false);
    expect(isBookFinished({ status: "reading", percent: 1 } as never)).toBe(false);
  });
});

describe("partitionCompleted", () => {
  const b = (
    id: string,
    over: Partial<Pick<Book, "status" | "finished_at" | "archived_at">> = {},
  ) => ({
    id,
    status: "reading" as const,
    finished_at: null,
    archived_at: null,
    ...over,
  });
  const done = (id: string, at: string) =>
    b(id, { status: "finished", finished_at: at });

  it("moves finished books out of the rest, keeping the rest's order", () => {
    const { rest, completed } = partitionCompleted([
      b("a"),
      done("x", "2026-09-01T00:00:00Z"),
      b("c"),
    ]);
    expect(rest.map((k) => k.id)).toEqual(["a", "c"]);
    expect(completed.map((k) => k.id)).toEqual(["x"]);
  });

  it("orders completed books by finished_at, most recent first", () => {
    const { completed } = partitionCompleted([
      done("old", "2026-01-01T00:00:00Z"),
      done("new", "2026-09-30T00:00:00Z"),
      done("mid", "2026-05-01T00:00:00Z"),
    ]);
    expect(completed.map((k) => k.id)).toEqual(["new", "mid", "old"]);
  });

  it("never treats an archived finished book as completed", () => {
    const archived = b("hidden", {
      status: "finished",
      finished_at: "2026-09-01T00:00:00Z",
      archived_at: "2026-09-02T00:00:00Z",
    });
    const { rest, completed } = partitionCompleted([archived]);
    expect(completed).toEqual([]);
    expect(rest).toEqual([archived]);
  });

  it("leaves everything in rest when nothing is finished", () => {
    const { rest, completed } = partitionCompleted([b("a"), b("b")]);
    expect(completed).toEqual([]);
    expect(rest).toHaveLength(2);
  });
});
