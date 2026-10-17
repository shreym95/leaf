import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReaderNotes, type ReaderNotesProps } from "./ReaderNotes";
import type { GroupReadsState } from "./useGroupReads";
import type { Annotation } from "@/lib/types";
import type { LocatedCfi } from "@/reader/engine";
import { shareAnnotation } from "@/lib/db/read-notes";

// Share waits for the item's pending write. These tests drive `writer` by hand.

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

const range: Annotation = {
  id: "r1",
  user_id: "me",
  book_id: "book-1",
  kind: "range",
  cfi: "epubcfi(/6/4!/4/2,/1:0,/1:5)",
  quote: "a quoted line",
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

const located: LocatedCfi = {
  spineIndex: 0,
  spineHref: "ch1.xhtml",
  sectionFraction: 0.5,
  exact: true,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderWithWriter(writer: ReaderNotesProps["writer"]) {
  render(
    <ReaderNotes
      mine={[range]}
      groupReads={{ userId: "me", reads }}
      locateCfi={() => located}
      offline={false}
      onJump={vi.fn()}
      onSaveNote={vi.fn()}
      onRemove={vi.fn()}
      writer={writer}
    />,
  );
}

async function clickShare() {
  await userEvent.click(screen.getByRole("button", { name: "Actions for a quoted line" }));
  await userEvent.click(screen.getByRole("button", { name: "Share with Book Club" }));
}

beforeEach(() => {
  flag.on = true;
  vi.mocked(shareAnnotation).mockClear();
});

describe("ReaderNotes — share waits for the annotation writer", () => {
  it("waits for the item's writes to settle before sharing", async () => {
    const settle = deferred();
    const settled = vi.fn(() => settle.promise);
    const writer = { settled, isPending: vi.fn(async () => false) };
    renderWithWriter(writer);

    await clickShare();

    expect(settled).toHaveBeenCalledWith("r1");
    // The write is still in flight: nothing is shared yet.
    expect(shareAnnotation).not.toHaveBeenCalled();

    settle.resolve();
    await waitFor(() => expect(shareAnnotation).toHaveBeenCalledTimes(1));
    expect(shareAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ annotation: range, readId: "read-1" }),
    );
  });

  it("refuses to share while the item is still queued: 'Still saving…' and no share call", async () => {
    const writer = {
      settled: vi.fn(async () => {}),
      isPending: vi.fn(async () => true),
    };
    renderWithWriter(writer);

    await clickShare();

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Still saving. Try again in a moment.",
      ),
    );
    expect(writer.isPending).toHaveBeenCalledWith("r1");
    expect(shareAnnotation).not.toHaveBeenCalled();
  });

  it("shares as before when the item has no pending write", async () => {
    const writer = {
      settled: vi.fn(async () => {}),
      isPending: vi.fn(async () => false),
    };
    renderWithWriter(writer);

    await clickShare();

    await waitFor(() => expect(shareAnnotation).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
