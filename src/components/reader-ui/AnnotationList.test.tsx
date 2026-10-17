import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Annotation, VisibleReadNote } from "@/lib/types";
import type { AnnotationGroupContext, AnnotationListItem } from "./annotation-list";
import { AnnotationList, type AnnotationListProps } from "./AnnotationList";

afterEach(cleanup);

function ann(over: Partial<Annotation>): Annotation {
  return {
    id: "a1",
    user_id: "me",
    book_id: "b1",
    kind: "page",
    cfi: "epubcfi(/6/2)",
    quote: null,
    note: null,
    label: "Chapter One",
    percent: 0.25,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

function groupNote(over: Partial<VisibleReadNote>): VisibleReadNote {
  return {
    id: "g1",
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

const ONE_READ: AnnotationGroupContext = {
  reads: [{ id: "r1", groupName: "Book Club" }],
  notes: [
    groupNote({ id: "g1", user_id: "ann", note: "Great line" }),
    groupNote({ id: "g2", user_id: "me", kind: "highlight", quote_exact: "the sea" }),
  ],
  names: { ann: "Ann" },
  meId: "me",
};

const TWO_READS: AnnotationGroupContext = {
  reads: [
    { id: "r1", groupName: "Book Club" },
    { id: "r2", groupName: "Night Owls" },
  ],
  notes: [
    groupNote({ id: "g1", read_id: "r1", user_id: "ann", note: "In Book Club" }),
    groupNote({ id: "g2", read_id: "r2", user_id: "ann", note: "In Night Owls" }),
  ],
  names: { ann: "Ann" },
  meId: "me",
};

function props(over: Partial<AnnotationListProps> = {}): AnnotationListProps {
  return {
    mine: [],
    group: null,
    sharedReadIds: {},
    sectionLabelFor: (item: AnnotationListItem) =>
      item.source === "mine" ? (item.annotation.label ?? "Unknown") : "Chapter One",
    canJump: () => true,
    onJump: vi.fn(),
    onSaveNote: vi.fn(),
    onRemove: vi.fn(),
    onShare: vi.fn(),
    onUnshare: vi.fn(),
    ...over,
  };
}

function openActions(name: RegExp | string) {
  return userEvent.click(screen.getByRole("button", { name }));
}

describe("AnnotationList: filter", () => {
  it("hides the Mine / Group filter when there is no group", () => {
    render(<AnnotationList {...props({ group: null })} />);
    expect(screen.queryByRole("radio", { name: "Group" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Mine" })).toBeNull();
  });

  it("shows the filter as a radio group with Mine selected by default", () => {
    render(<AnnotationList {...props({ group: ONE_READ })} />);
    expect(screen.getByRole("radio", { name: "Mine" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Group" })).not.toBeChecked();
  });

  it("switches to the Group view and shows only group items", async () => {
    render(
      <AnnotationList
        {...props({
          group: ONE_READ,
          mine: [ann({ id: "m1", kind: "range", quote: "mine only quote" })],
        })}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Group" }));
    expect(screen.getByText("Great line")).toBeInTheDocument();
    expect(screen.getByText("the sea")).toBeInTheDocument();
    expect(screen.queryByText("mine only quote")).toBeNull();
    expect(screen.getByText("Ann")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("shows a group picker by name only with more than one read", async () => {
    const { unmount } = render(<AnnotationList {...props({ group: ONE_READ })} />);
    await userEvent.click(screen.getByRole("radio", { name: "Group" }));
    expect(screen.queryByRole("combobox", { name: "Group" })).toBeNull();
    unmount();

    render(<AnnotationList {...props({ group: TWO_READS })} />);
    await userEvent.click(screen.getByRole("radio", { name: "Group" }));
    expect(screen.getByText("In Book Club")).toBeInTheDocument();
    expect(screen.queryByText("In Night Owls")).toBeNull();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Group" }), "r2");
    expect(screen.getByText("In Night Owls")).toBeInTheDocument();
    expect(screen.queryByText("In Book Club")).toBeNull();
  });

  it("shows the group empty line when no visible note matches", async () => {
    render(<AnnotationList {...props({ group: { ...ONE_READ, notes: [] } })} />);
    await userEvent.click(screen.getByRole("radio", { name: "Group" }));
    expect(screen.getByText("No marks or notes yet.")).toBeInTheDocument();
  });
});

describe("AnnotationList: Mine view", () => {
  it("shows the Mine empty line with the dock hint", () => {
    render(<AnnotationList {...props()} />);
    expect(
      screen.getByText(
        "No marks or notes yet. Long-press text to highlight, or mark this page from the dock.",
      ),
    ).toBeInTheDocument();
  });

  it("groups items by chapter label in the order given", () => {
    render(
      <AnnotationList
        {...props({
          mine: [
            ann({ id: "a", label: "One", kind: "page" }),
            ann({ id: "b", label: "One", kind: "range", quote: "first quote" }),
            ann({ id: "c", label: "Two", kind: "page" }),
          ],
        })}
      />,
    );
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["One", "Two"]);
    const sections = screen.getAllByRole("list").map((ul) => within(ul).getAllByRole("listitem").length);
    expect(sections).toEqual([2, 1]);
  });

  it("clamps a highlight quote to two lines and says Marked page for a mark", () => {
    render(
      <AnnotationList
        {...props({
          mine: [
            ann({ id: "a", kind: "range", quote: "a long quoted line" }),
            ann({ id: "b", kind: "page" }),
          ],
        })}
      />,
    );
    expect(screen.getByText("a long quoted line")).toHaveClass("line-clamp-2");
    expect(screen.getByText("Marked page")).toBeInTheDocument();
  });

  it("shows the note text and the percent caption", () => {
    render(
      <AnnotationList
        {...props({ mine: [ann({ id: "a", kind: "page", note: "remember this", percent: 0.4 })] })}
      />,
    );
    expect(screen.getByText("remember this")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("keeps the row actions closed until its ⋯ is tapped", async () => {
    render(<AnnotationList {...props({ mine: [ann({ id: "a", kind: "page" })] })} />);
    const more = screen.getByRole("button", { name: "Actions for Marked page" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Jump" })).toBeNull();
    await userEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Jump" })).toBeInTheDocument();
  });

  it("omits Jump when the item cannot be jumped to", async () => {
    render(
      <AnnotationList
        {...props({ mine: [ann({ id: "a", kind: "page" })], canJump: () => false })}
      />,
    );
    await openActions("Actions for Marked page");
    expect(screen.queryByRole("button", { name: "Jump" })).toBeNull();
  });

  it("calls onJump with the item", async () => {
    const onJump = vi.fn();
    render(<AnnotationList {...props({ mine: [ann({ id: "a", kind: "page" })], onJump })} />);
    await openActions("Actions for Marked page");
    await userEvent.click(screen.getByRole("button", { name: "Jump" }));
    expect(onJump).toHaveBeenCalledWith({
      source: "mine",
      annotation: expect.objectContaining({ id: "a" }),
    });
  });

  it("names the action Add note on a row without a note, Edit note otherwise", async () => {
    render(
      <AnnotationList
        {...props({
          mine: [
            ann({ id: "a", kind: "range", quote: "alpha" }),
            ann({ id: "b", kind: "range", quote: "beta", note: "has one" }),
          ],
        })}
      />,
    );
    await openActions("Actions for alpha");
    expect(screen.getByRole("button", { name: "Add note" })).toBeInTheDocument();
    await openActions("Actions for beta");
    expect(screen.getByRole("button", { name: "Edit note" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add note" })).toBeNull();
  });

  it("saves a trimmed note through onSaveNote and returns focus to the note button", async () => {
    const onSaveNote = vi.fn();
    render(<AnnotationList {...props({ mine: [ann({ id: "a", kind: "page" })], onSaveNote })} />);
    await openActions("Actions for Marked page");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    const field = screen.getByRole("textbox", { name: "Note" });
    expect(field).toHaveFocus();
    await userEvent.type(field, "  hello  ");
    expect(screen.getByText("5/500")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveNote).toHaveBeenCalledWith("a", "hello");
    // The label stays "Add note" until the parent passes the saved note back in.
    expect(screen.getByRole("button", { name: "Add note" })).toHaveFocus();
  });

  it("saves an empty draft as null, which removes the note", async () => {
    const onSaveNote = vi.fn();
    render(
      <AnnotationList
        {...props({ mine: [ann({ id: "a", kind: "page", note: "old" })], onSaveNote })}
      />,
    );
    await openActions("Actions for Marked page");
    await userEvent.click(screen.getByRole("button", { name: "Edit note" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Note" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveNote).toHaveBeenCalledWith("a", null);
  });

  it("blocks Save over 500 characters and shows the count", async () => {
    const onSaveNote = vi.fn();
    render(<AnnotationList {...props({ mine: [ann({ id: "a", kind: "page" })], onSaveNote })} />);
    await openActions("Actions for Marked page");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireChange(screen.getByRole("textbox", { name: "Note" }), "n".repeat(501));
    expect(screen.getByText("501/500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("Up to 500 characters.")).toBeInTheDocument();
    expect(onSaveNote).not.toHaveBeenCalled();
  });

  it("Cancel closes the form without saving", async () => {
    const onSaveNote = vi.fn();
    render(<AnnotationList {...props({ mine: [ann({ id: "a", kind: "page" })], onSaveNote })} />);
    await openActions("Actions for Marked page");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();
    expect(onSaveNote).not.toHaveBeenCalled();
  });

  it("removes a mark without a note at once", async () => {
    const onRemove = vi.fn();
    render(<AnnotationList {...props({ mine: [ann({ id: "a", kind: "page" })], onRemove })} />);
    await openActions("Actions for Marked page");
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledWith("a");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks before removing an item that has a note", async () => {
    const onRemove = vi.fn();
    render(
      <AnnotationList
        {...props({ mine: [ann({ id: "a", kind: "range", quote: "q", note: "n" })], onRemove })}
      />,
    );
    await openActions("Actions for q");
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("dialog");
    expect(onRemove).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledWith("a");
  });

  it("offers one Share per group read and a Shared with line once shared", async () => {
    render(
      <AnnotationList
        {...props({
          group: TWO_READS,
          mine: [ann({ id: "a", kind: "page" })],
          sharedReadIds: { a: ["r2"] },
        })}
      />,
    );
    expect(screen.getByText("Shared with Night Owls")).toBeInTheDocument();
    await openActions("Actions for Marked page");
    expect(screen.getByRole("button", { name: "Share with Book Club" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unshare from Night Owls" })).toBeInTheDocument();
  });

  it("calls onShare and onUnshare with the item and read id", async () => {
    const onShare = vi.fn();
    const onUnshare = vi.fn();
    render(
      <AnnotationList
        {...props({
          group: TWO_READS,
          mine: [ann({ id: "a", kind: "page" })],
          sharedReadIds: { a: ["r2"] },
          onShare,
          onUnshare,
        })}
      />,
    );
    await openActions("Actions for Marked page");
    await userEvent.click(screen.getByRole("button", { name: "Share with Book Club" }));
    expect(onShare).toHaveBeenCalledWith("a", "r1");
    await userEvent.click(screen.getByRole("button", { name: "Unshare from Night Owls" }));
    expect(onUnshare).toHaveBeenCalledWith("a", "r2");
  });

  it("hides share controls when there is no group", async () => {
    render(<AnnotationList {...props({ mine: [ann({ id: "a", kind: "page" })] })} />);
    await openActions("Actions for Marked page");
    expect(screen.queryByRole("button", { name: /Share/ })).toBeNull();
  });

  it("disables Share and says Needs a connection while offline", async () => {
    render(
      <AnnotationList
        {...props({ group: ONE_READ, mine: [ann({ id: "a", kind: "page" })], offline: true })}
      />,
    );
    await openActions("Actions for Marked page");
    expect(screen.getByRole("button", { name: "Share with Book Club" })).toBeDisabled();
    expect(screen.getByText("Needs a connection")).toBeInTheDocument();
  });

  it("states the 300-character share limit only for a longer quote", async () => {
    const { unmount } = render(
      <AnnotationList
        {...props({
          group: ONE_READ,
          mine: [ann({ id: "a", kind: "range", quote: "x".repeat(301) })],
        })}
      />,
    );
    await openActions(/Actions for x/);
    expect(screen.getByText("Shares the first 300 characters")).toBeInTheDocument();
    unmount();

    render(
      <AnnotationList
        {...props({
          group: ONE_READ,
          mine: [ann({ id: "a", kind: "range", quote: "x".repeat(300) })],
        })}
      />,
    );
    await openActions(/Actions for x/);
    expect(screen.queryByText("Shares the first 300 characters")).toBeNull();
  });
});

// Sets a textarea's value in one change event, for the over-limit path.
function fireChange(field: HTMLElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
