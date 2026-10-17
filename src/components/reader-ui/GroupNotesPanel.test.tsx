import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Alignment, Outline } from "@/lib/groups/types";
import type { VisibleReadNote } from "@/lib/types";
import type { GroupReadContext } from "./group-notes";
import type { GroupReadsState } from "./useGroupReads";

const h = vi.hoisted(() => ({
  createClient: vi.fn(() => ({})),
  list: vi.fn(),
  add: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: h.createClient }));
vi.mock("@/lib/db/read-notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/read-notes")>()),
  listVisibleNotes: h.list,
  addReadNote: h.add,
  deleteReadNote: h.del,
}));

import { GroupNotesPanel, type GroupNotesPanelProps } from "./GroupNotesPanel";

const outline: Outline = [
  { index: 0, label: "One", depth: 0, partIndex: null, partLabel: null, href: "o1.xhtml" },
  { index: 1, label: "Two", depth: 0, partIndex: null, partLabel: null, href: "o2.xhtml" },
  { index: 2, label: "Three", depth: 0, partIndex: null, partLabel: null, href: "o3.xhtml" },
];

// My copy maps two chapters; chapter 3 ("Three") is not in my copy.
const alignment: Alignment = {
  map: { "c1.html": 0, "c2.html": 1 },
  copyHrefs: ["c1.html", "c2.html"],
  confidence: 2 / 3,
  identity: false,
};

function readCtx(readId: string, groupName: string, sha: string | null): GroupReadContext {
  return {
    readId,
    groupId: `g-${readId}`,
    groupName,
    outline,
    alignment,
    copySha256: sha,
    names: new Map([["ann", "Ann"]]),
  };
}

const ctxOne: GroupReadsState = { userId: "me", reads: [readCtx("r1", "Book Club", "sha-mine")] };
const ctxTwo: GroupReadsState = {
  userId: "me",
  reads: [readCtx("r1", "Book Club", "sha-mine"), readCtx("r2", "Night Owls", "sha-2")],
};

const place = { cfi: "cfi-here", spineHref: "c2.html", sectionFraction: 0.25 };

function note(over: Partial<VisibleReadNote>): VisibleReadNote {
  return {
    id: "x",
    read_id: "r1",
    user_id: "ann",
    chapter_index: 0,
    chapter_fraction: 0,
    kind: "mark",
    note: null,
    cfi: null,
    content_sha256: "sha-other",
    created_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

const OWN_MARK = note({
  id: "m-own",
  user_id: "me",
  chapter_index: 0,
  cfi: "cfi-own",
  content_sha256: "sha-mine",
});
const ANN_NOTE = note({ id: "n-ann", kind: "note", note: "Good line", chapter_index: 1, cfi: "cfi-ann" });
const ANN_MARK_UNMAPPED = note({ id: "m-ann", chapter_index: 2 });

function renderPanel(over: Partial<GroupNotesPanelProps> = {}) {
  const onJump = vi.fn();
  render(<GroupNotesPanel ctx={ctxOne} place={place} onJump={onJump} {...over} />);
  return { onJump };
}

beforeEach(() => {
  for (const f of [h.createClient, h.list, h.add, h.del]) f.mockReset();
  h.createClient.mockImplementation(() => ({}));
  h.list.mockResolvedValue([OWN_MARK, ANN_NOTE, ANN_MARK_UNMAPPED]);
  h.add.mockResolvedValue({});
  h.del.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("GroupNotesPanel: list", () => {
  it("lists notes grouped by chapter in outline order, with names and delete on my own only", async () => {
    renderPanel();
    await screen.findByText("Good line");
    expect(h.list).toHaveBeenCalledWith("r1", {});

    const headings = ["One", "Two", "Three"].map((l) => screen.getByText(l));
    expect(headings[0].compareDocumentPosition(headings[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(headings[1].compareDocumentPosition(headings[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getAllByText("Ann").length).toBeGreaterThan(0);
    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Delete this mark" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Delete this note" })).toBeNull();
  });

  it("shows the empty message when there is nothing visible", async () => {
    h.list.mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText("No marks or notes yet.")).toBeInTheDocument();
  });

  it("refetches on window focus", async () => {
    renderPanel();
    await screen.findByText("Good line");
    h.list.mockClear();
    fireEvent.focus(window);
    await waitFor(() => expect(h.list).toHaveBeenCalledWith("r1", {}));
  });

  it("offers a retry when the list fails, and recovers on retry", async () => {
    const user = userEvent.setup();
    h.list.mockRejectedValueOnce(new Error("boom"));
    renderPanel();
    expect(await screen.findByText("Couldn't load marks and notes.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Good line")).toBeInTheDocument();
  });
});

describe("GroupNotesPanel: create", () => {
  it("marks my current page at its outline position with my CFI and copy hash", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Good line");
    await user.click(screen.getByRole("button", { name: "Mark this page" }));
    await waitFor(() =>
      expect(h.add).toHaveBeenCalledWith(
        expect.objectContaining({
          readId: "r1",
          userId: "me",
          position: { chapterIndex: 1, chapterFraction: 0.25 },
          kind: "mark",
          cfi: "cfi-here",
          contentSha256: "sha-mine",
        }),
        expect.anything(),
      ),
    );
    expect(h.add.mock.calls[0][0].note).toBeUndefined();
  });

  it("rejects an empty note and a 501-character note, and accepts 500", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Good line");
    await user.click(screen.getByRole("button", { name: "Add a note" }));
    const box = screen.getByRole("textbox", { name: "Note" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    fireEvent.change(box, { target: { value: "   " } });
    expect(save).toBeDisabled();

    fireEvent.change(box, { target: { value: "a".repeat(501) } });
    expect(screen.getByText("501/500")).toBeInTheDocument();
    expect(save).toBeDisabled();

    fireEvent.change(box, { target: { value: "a".repeat(500) } });
    expect(screen.getByText("500/500")).toBeInTheDocument();
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() =>
      expect(h.add).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "note", note: "a".repeat(500), contentSha256: "sha-mine" }),
        expect.anything(),
      ),
    );
    expect(h.add).toHaveBeenCalledTimes(1);
  });

  it("says so when the write fails, and keeps the note form open", async () => {
    const user = userEvent.setup();
    h.add.mockRejectedValueOnce(new Error("rls"));
    renderPanel();
    await screen.findByText("Good line");
    await user.click(screen.getByRole("button", { name: "Mark this page" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save. Try again.");
  });

  it("does not write offline and says it could not save", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
    try {
      renderPanel();
      await screen.findByText("Good line");
      await user.click(screen.getByRole("button", { name: "Mark this page" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save. Try again.");
      expect(h.add).not.toHaveBeenCalled();
    } finally {
      delete (window.navigator as { onLine?: boolean }).onLine;
    }
  });

  it("cannot write when my place is unknown", async () => {
    renderPanel({ place: null });
    await screen.findByText("Good line");
    expect(screen.getByRole("button", { name: "Mark this page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add a note" })).toBeDisabled();
  });

  it("shows a group picker only when linked to more than one read, and writes to the one chosen", async () => {
    const user = userEvent.setup();
    h.list.mockImplementation(async (id: string) => (id === "r1" ? [OWN_MARK] : []));
    const { unmount } = render(<GroupNotesPanel ctx={ctxTwo} place={place} onJump={() => {}} />);
    await screen.findByText("Marked this page");
    const picker = screen.getByRole("combobox", { name: "Group" });
    await user.selectOptions(picker, "Night Owls");
    await user.click(screen.getByRole("button", { name: "Mark this page" }));
    await waitFor(() => expect(h.add).toHaveBeenCalled());
    expect(h.add.mock.calls[0][0]).toMatchObject({ readId: "r2", contentSha256: "sha-2" });
    unmount();

    h.list.mockResolvedValue([OWN_MARK, ANN_NOTE, ANN_MARK_UNMAPPED]);
    renderPanel();
    await screen.findByText("Good line");
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("GroupNotesPanel: delete", () => {
  it("deletes my own item and reloads", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Good line");
    await user.click(screen.getByRole("button", { name: "Delete this mark" }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith("m-own", expect.anything()));
    await waitFor(() => expect(h.list.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("says so when the delete fails", async () => {
    const user = userEvent.setup();
    h.del.mockRejectedValueOnce(new Error("rls"));
    renderPanel();
    await screen.findByText("Good line");
    await user.click(screen.getByRole("button", { name: "Delete this mark" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete. Try again.");
  });
});

describe("GroupNotesPanel: jump", () => {
  it("jumps to the CFI when the note was taken from the same copy", async () => {
    const user = userEvent.setup();
    const { onJump } = renderPanel();
    await screen.findByText("Good line");
    await user.click(screen.getByRole("button", { name: /Marked this page/ }));
    expect(onJump).toHaveBeenCalledWith("cfi-own");
  });

  it("jumps to the chapter start in my copy and labels the item with the chapter", async () => {
    const user = userEvent.setup();
    const { onJump } = renderPanel();
    await screen.findByText("Good line");
    const item = screen.getByRole("button", { name: /Good line/ });
    expect(item).toHaveTextContent("in Two");
    await user.click(item);
    expect(onJump).toHaveBeenCalledWith("c2.html");
  });

  it("is not tappable when the chapter cannot be placed in my copy", async () => {
    renderPanel();
    await screen.findByText("Good line");
    expect(screen.getAllByText("Marked this page")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Marked this page/ })).toHaveLength(1);
  });
});
