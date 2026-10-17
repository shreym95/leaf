import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReaderNotes, type ReaderNotesProps } from "./ReaderNotes";
import type { GroupReadsState } from "./useGroupReads";
import type { Annotation } from "@/lib/types";
import type { LocatedCfi } from "@/reader/engine";
import {
  listSharedReads,
  listVisibleNotes,
  shareAnnotation,
} from "@/lib/db/read-notes";

// The group flag is read per render, so a getter lets one test turn it off.
const flag = vi.hoisted(() => ({ on: true }));
vi.mock("@/lib/groups/flag", () => ({
  get GROUPS_ENABLED() {
    return flag.on;
  },
}));

vi.mock("@/lib/db/read-notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/read-notes")>()),
  listVisibleNotes: vi.fn(async () => []),
  listSharedReads: vi.fn(async () => []),
  shareAnnotation: vi.fn(async () => ({ id: "share-1", truncated: false })),
  unshareAnnotation: vi.fn(async () => {}),
}));

const ann: Annotation = {
  id: "a1",
  user_id: "me",
  book_id: "book-1",
  kind: "page",
  cfi: "epubcfi(/6/4!/4/2)",
  quote: null,
  note: null,
  label: "Chapter One",
  percent: 0.25,
  created_at: "2026-10-17T10:00:00.000Z",
  updated_at: "2026-10-17T10:00:00.000Z",
};

const reads: GroupReadsState["reads"] = [
  {
    readId: "read-1",
    groupId: "group-1",
    groupName: "Book Club",
    outline: [
      {
        index: 0,
        label: "Chapter One",
        depth: 0,
        partIndex: null,
        partLabel: null,
        href: "ch1.xhtml",
      },
    ],
    alignment: {
      map: { "ch1.xhtml": 0 },
      copyHrefs: ["ch1.xhtml"],
      confidence: 1,
      identity: true,
    },
    copySha256: "sha-1",
    names: new Map([["ana", "Ana"]]),
  },
];

function renderNotes(over: Partial<ReaderNotesProps> = {}) {
  const props: ReaderNotesProps = {
    mine: [ann],
    groupReads: null,
    locateCfi: () => null,
    offline: false,
    onJump: vi.fn(),
    onSaveNote: vi.fn(),
    onRemove: vi.fn(),
    ...over,
  };
  render(<ReaderNotes {...props} />);
  return props;
}

beforeEach(() => {
  flag.on = true;
  vi.mocked(listVisibleNotes).mockClear();
  vi.mocked(listSharedReads).mockClear();
  vi.mocked(shareAnnotation).mockClear();
});

describe("ReaderNotes — group gating", () => {
  it("makes no group request and shows no Group filter without a linked read", () => {
    renderNotes({ groupReads: null });

    expect(screen.queryByRole("radio", { name: "Group" })).toBeNull();
    expect(listVisibleNotes).not.toHaveBeenCalled();
    expect(listSharedReads).not.toHaveBeenCalled();
  });

  it("makes no group request when the flag is off, even with a linked read", () => {
    flag.on = false;
    renderNotes({ groupReads: { userId: "me", reads } });

    expect(screen.queryByRole("radio", { name: "Group" })).toBeNull();
    expect(listVisibleNotes).not.toHaveBeenCalled();
    expect(listSharedReads).not.toHaveBeenCalled();
  });

  it("makes no group request while offline, group items load online only", () => {
    renderNotes({ groupReads: { userId: "me", reads }, offline: true });

    expect(screen.queryByRole("radio", { name: "Group" })).toBeNull();
    expect(listVisibleNotes).not.toHaveBeenCalled();
    expect(listSharedReads).not.toHaveBeenCalled();
  });

  it("loads group notes and share state once a linked read is present", async () => {
    renderNotes({ groupReads: { userId: "me", reads } });

    expect(screen.getByRole("radio", { name: "Group" })).toBeTruthy();
    await waitFor(() =>
      expect(listVisibleNotes).toHaveBeenCalledWith("read-1"),
    );
    await waitFor(() =>
      expect(listSharedReads).toHaveBeenCalledWith("a1"),
    );
  });
});

const range: Annotation = {
  ...ann,
  id: "r1",
  kind: "range",
  cfi: "epubcfi(/6/4!/4/2,/1:0,/1:5)",
  quote: "a quoted line",
  label: "Chapter One",
};

function located(over: Partial<LocatedCfi> = {}): LocatedCfi {
  return { spineIndex: 0, spineHref: "ch1.xhtml", sectionFraction: 0.5, exact: true, ...over };
}

describe("ReaderNotes — sharing any item", () => {
  it("shares a range item at the position its CFI locates in the group's book", async () => {
    const locateCfi = vi.fn(() => located({ sectionFraction: 0.5 }));
    renderNotes({ mine: [range], groupReads: { userId: "me", reads }, locateCfi });

    await userEvent.click(screen.getByRole("button", { name: "Actions for a quoted line" }));
    await userEvent.click(screen.getByRole("button", { name: "Share with Book Club" }));

    expect(locateCfi).toHaveBeenCalledWith(range.cfi);
    await waitFor(() =>
      expect(shareAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          annotation: range,
          readId: "read-1",
          position: { chapterIndex: 0, chapterFraction: 0.5 },
        }),
      ),
    );
  });

  it("uses fraction 1 for an item in a section that is not rendered", async () => {
    const locateCfi = vi.fn(() => located({ sectionFraction: 1, exact: false }));
    renderNotes({ mine: [range], groupReads: { userId: "me", reads }, locateCfi });

    await userEvent.click(screen.getByRole("button", { name: "Actions for a quoted line" }));
    await userEvent.click(screen.getByRole("button", { name: "Share with Book Club" }));

    await waitFor(() =>
      expect(shareAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({ position: { chapterIndex: 0, chapterFraction: 1 } }),
      ),
    );
  });

  it("disables Share and says so when the item cannot be placed in the group's book", async () => {
    renderNotes({
      mine: [range],
      groupReads: { userId: "me", reads },
      locateCfi: () => null,
    });

    await userEvent.click(screen.getByRole("button", { name: "Actions for a quoted line" }));

    expect(screen.getByRole("button", { name: "Share with Book Club" })).toBeDisabled();
    expect(screen.getByText("Can't place this item in the group's book.")).toBeTruthy();
    expect(shareAnnotation).not.toHaveBeenCalled();
  });
});
