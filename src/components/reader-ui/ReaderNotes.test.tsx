import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ReaderNotes, type ReaderNotesProps } from "./ReaderNotes";
import type { GroupReadsState } from "./useGroupReads";
import type { Annotation } from "@/lib/types";
import {
  listSharedReads,
  listVisibleNotes,
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
    alignment: null,
    copySha256: "sha-1",
    names: new Map([["ana", "Ana"]]),
  },
];

function renderNotes(over: Partial<ReaderNotesProps> = {}) {
  const props: ReaderNotesProps = {
    mine: [ann],
    groupReads: null,
    place: {},
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
