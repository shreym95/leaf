import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Outline } from "@/lib/groups/types";
import type {
  GroupMemberName,
  ReadMilestone,
  ReadProgress,
  VisibleReadNote,
} from "@/lib/types";

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  deleteReadNote: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: h.refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/db/groups", () => ({ setManualProgress: vi.fn() }));
vi.mock("@/lib/db/read-notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/read-notes")>()),
  deleteReadNote: (...args: unknown[]) => h.deleteReadNote(...args),
}));
vi.mock("./useOwnBooks", () => ({ useOwnBooks: () => ({ kind: "idle" }) }));

import { ReadScreen, type ReadScreenProps } from "./ReadScreen";

const outline: Outline = [
  { index: 0, label: "Preface", depth: 0, partIndex: null, partLabel: null, href: "a" },
  { index: 1, label: "Chapter 1", depth: 1, partIndex: 0, partLabel: "The Quiet Town", href: "b" },
  { index: 2, label: "Chapter 2", depth: 1, partIndex: 1, partLabel: "The Storm Breaks", href: "c" },
];
const members: GroupMemberName[] = [
  { user_id: "u1", display_name: "Ada", role: "owner", joined_at: "2026-01-01" },
  { user_id: "u2", display_name: "Ben", role: "member", joined_at: "2026-01-02" },
  { user_id: "u3", display_name: "Cy", role: "member", joined_at: "2026-01-03" },
];
const progress: ReadProgress[] = [];
const schedule = [
  { chapter_index: 1, due_on: "2099-03-01" },
  { chapter_index: 2, due_on: "2099-04-01" },
];

function renderScreen(over: Partial<ReadScreenProps> = {}, readOver: Partial<ReadScreenProps["read"]> = {}) {
  return render(
    <ReadScreen
      groupId="g1"
      groupName="Tuesday club"
      currentUserId="u3"
      read={{
        id: "r1",
        title: "Middlemarch",
        author: "George Eliot",
        source: "standardebooks",
        outline,
        createdBy: "u2",
        ...readOver,
      }}
      members={members}
      progress={progress}
      milestones={[]}
      copy={null}
      {...over}
    />,
  );
}

const note = (over: Partial<VisibleReadNote>): VisibleReadNote => ({
  id: "n1",
  read_id: "r1",
  user_id: "u2",
  chapter_index: 1,
  chapter_fraction: 0.2,
  kind: "note",
  note: "Remember this",
  cfi: null,
  content_sha256: null,
  created_at: "2026-02-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  h.refresh.mockReset();
  h.deleteReadNote.mockReset();
  h.deleteReadNote.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("ReadScreen schedule", () => {
  it("shows a set schedule to a plain member, without an editor", () => {
    renderScreen({}, { schedule });
    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Checkpoints" });
    expect(within(list).getByText("Through Chapter 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /schedule/i })).toBeNull();
  });

  it("shows nothing about a schedule to a plain member when none is set", () => {
    renderScreen();
    expect(screen.queryByRole("heading", { name: "Schedule" })).toBeNull();
    expect(screen.queryByText("No schedule set.")).toBeNull();
  });

  it("offers Set schedule to the owner when none is set", () => {
    renderScreen({ currentUserId: "u1" });
    expect(screen.getByText("No schedule set.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set schedule" })).toBeInTheDocument();
  });

  it("opens the editor from Edit schedule for the owner", async () => {
    renderScreen({ currentUserId: "u1" }, { schedule });
    await userEvent.click(screen.getByRole("button", { name: "Edit schedule" }));
    expect(await screen.findByRole("dialog", { name: "Reading schedule" })).toBeInTheDocument();
  });

  it("offers the editor to the member who added the read", () => {
    renderScreen({ currentUserId: "u2" }, { schedule });
    expect(screen.getByRole("button", { name: "Edit schedule" })).toBeInTheDocument();
  });

  it("hides the editor from another member", () => {
    renderScreen({ currentUserId: "u3" }, { schedule });
    expect(screen.queryByRole("button", { name: "Edit schedule" })).toBeNull();
  });
});

describe("ReadScreen marks and notes", () => {
  it("hides the section when the notes could not be loaded", () => {
    renderScreen({ notes: null });
    expect(screen.queryByRole("heading", { name: "Marks and notes" })).toBeNull();
    renderScreen();
    expect(screen.queryByRole("heading", { name: "Marks and notes" })).toBeNull();
  });

  it("says so when there are no marks or notes", () => {
    renderScreen({ notes: [] });
    expect(screen.getByRole("heading", { name: "Marks and notes" })).toBeInTheDocument();
    expect(screen.getByText("No marks or notes yet.")).toBeInTheDocument();
  });

  it("deletes the viewer's own note and refreshes", async () => {
    renderScreen({
      currentUserId: "u2",
      notes: [note({ id: "mine", user_id: "u2", note: "Mine" }), note({ id: "theirs", user_id: "u3", note: "Theirs" })],
    });
    expect(screen.getByText("Theirs")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete your note in Chapter 1" }));
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.deleteReadNote).toHaveBeenCalledWith("mine", {});
  });
});

describe("ReadScreen checkpoint milestones", () => {
  it("names an unreached checkpoint by its position, not its chapter", () => {
    renderScreen({
      milestones: [
        { read_id: "r1", user_id: "u2", point: "checkpoint:1", reached_at: "2026-02-01T09:00:00Z" } as ReadMilestone,
        { read_id: "r1", user_id: "u2", point: "checkpoint:x", reached_at: "2026-02-02T09:00:00Z" } as ReadMilestone,
      ],
    }, { schedule });
    const feed = screen.getByRole("heading", { name: "Milestones" }).parentElement!;
    expect(within(feed).getByText("First to Checkpoint 1: Ben")).toBeInTheDocument();
    expect(feed.textContent ?? "").not.toContain("Chapter 1");
  });
});
