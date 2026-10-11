import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Outline } from "@/lib/groups/types";
import type { GroupMemberName, ReadMilestone, ReadProgress } from "@/lib/types";

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  setManualProgress: vi.fn(),
  books: vi.fn(),
  client: { tag: "browser-client" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: h.refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    ...h.client,
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        order: () => h.books(),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/db/groups", () => ({
  setManualProgress: (...args: unknown[]) => h.setManualProgress(...args),
}));

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
const progress: ReadProgress[] = [
  {
    read_id: "r1", user_id: "u2", chapter_index: 1, chapter_fraction: 0,
    percent: 0.3, finished_at: null, manual: true, updated_at: "2026-02-01T00:00:00Z",
  },
];
const milestones: ReadMilestone[] = [
  { read_id: "r1", user_id: "u2", point: "part:0", reached_at: "2026-02-01T09:00:00Z" },
  { read_id: "r1", user_id: "u2", point: "part:1", reached_at: "2026-02-02T09:00:00Z" },
];

function renderScreen(over: Partial<ReadScreenProps> = {}) {
  return render(
    <ReadScreen
      groupId="g1"
      groupName="Tuesday club"
      currentUserId="u1"
      read={{
        id: "r1", title: "Middlemarch", author: "George Eliot",
        source: "standardebooks", outline,
      }}
      members={members}
      progress={progress}
      milestones={milestones}
      copy={null}
      {...over}
    />,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.refresh.mockReset();
  h.setManualProgress.mockReset();
  h.setManualProgress.mockResolvedValue(undefined);
  h.books.mockReset();
  h.books.mockResolvedValue({
    data: [
      { id: "b1", title: "My Epub", author: "Someone", source: "upload", source_ref: null },
    ],
    error: null,
  });
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ linked: true, imported: true, alignment: { confidence: 0.9 } }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReadScreen header and outline", () => {
  it("shows title, author, a link back to the group and the sections", () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "Middlemarch" })).toBeInTheDocument();
    expect(screen.getByText("George Eliot")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tuesday club/ })).toHaveAttribute("href", "/groups/g1");
    for (const name of ["Your copy", "Where everyone is", "Milestones"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("places a member at their chapter, marks manual progress and lists who has not started", () => {
    renderScreen();
    const chapters = screen.getByRole("list", { name: "Chapters" });
    const row = within(chapters).getByText("Chapter 1").closest("li")!;
    expect(within(row).getByText("Ben")).toBeInTheDocument();
    expect(within(row).getByText("(set by hand)")).toBeInTheDocument();
    expect(screen.getByText("Not started: You, Cy")).toBeInTheDocument();
  });

  it("names Parts the viewer has reached and masks the rest, in the outline and the feed", () => {
    // Ada (viewer) has reached neither Part.
    renderScreen();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("The Quiet Town");
    expect(text).not.toContain("The Storm Breaks");
    const chapters = screen.getByRole("list", { name: "Chapters" });
    expect(within(chapters).getByText("Part 1")).toBeInTheDocument();
    expect(within(chapters).getByText("Part 2")).toBeInTheDocument();
    expect(screen.getByText("First to Part 2: Ben")).toBeInTheDocument();
  });

  it("shows first-to and everyone-reached lines with dates once all have arrived", () => {
    renderScreen({
      milestones: members.map((m, i) => ({
        read_id: "r1",
        user_id: m.user_id,
        point: "half",
        reached_at: `2026-03-0${i + 1}T09:00:00Z`,
      })),
    });
    expect(screen.getByText("Everyone reached Halfway")).toBeInTheDocument();
    expect(screen.getByText("First to Halfway: You")).toBeInTheDocument();
    expect(screen.getByText("Ben reached Halfway")).toBeInTheDocument();
    expect(screen.getAllByText("Mar 3, 2026").length).toBeGreaterThan(0);
  });

  it("says so when there are no milestones", () => {
    renderScreen({ milestones: [] });
    expect(screen.getByText("No milestones yet.")).toBeInTheDocument();
  });
});

describe("ReadScreen copy", () => {
  it("links Open book to the reader when the member has a copy", () => {
    renderScreen({ copy: { bookId: "book9", confidence: 0.95 } });
    expect(screen.getByRole("link", { name: "Open book" })).toHaveAttribute("href", "/reader/book9");
    expect(screen.queryByText(/don.t fully match/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to my library" })).not.toBeInTheDocument();
  });

  it("shows one line when the copy's chapters do not match well", () => {
    renderScreen({ copy: { bookId: "book9", confidence: 0.59 } });
    expect(
      screen.getByText("Your copy’s chapters don’t fully match. Progress may be approximate."),
    ).toBeInTheDocument();
  });

  it("does not show the line at the threshold or without an alignment", () => {
    renderScreen({ copy: { bookId: "book9", confidence: 0.6 } });
    expect(screen.queryByText(/don.t fully match/)).not.toBeInTheDocument();
    cleanup();
    renderScreen({ copy: { bookId: "book9", confidence: null } });
    expect(screen.queryByText(/don.t fully match/)).not.toBeInTheDocument();
  });

  it("adds a catalog read with no body, then refreshes", async () => {
    renderScreen();
    expect(screen.getByText("Each member uses their own copy.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add to my library" }));
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/groups/g1/reads/r1/copy", { method: "POST" });
    expect(screen.getByText("Added.")).toBeInTheDocument();
  });

  it("shows the route's error when adding fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "This book could not be read." }),
    });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Add to my library" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This book could not be read.");
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("lets a member choose their own book for an upload read", async () => {
    renderScreen({
      read: { id: "r1", title: "Zine", author: "", source: "upload", outline },
    });
    expect(screen.queryByRole("button", { name: "Add to my library" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Choose your copy" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose your copy" });
    await userEvent.click(await within(dialog).findByRole("button", { name: /My Epub/ }));
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/groups/g1/reads/r1/copy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookId: "b1" }),
    });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the dialog open and shows the error when choosing fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "That is not your book." }),
    });
    renderScreen({
      read: { id: "r1", title: "Zine", author: "", source: "upload", outline },
    });
    await userEvent.click(screen.getByRole("button", { name: "Choose your copy" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: /My Epub/ }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("That is not your book.");
    expect(h.refresh).not.toHaveBeenCalled();
  });
});

describe("ReadScreen manual progress", () => {
  it("labels the control for a member without a copy", () => {
    renderScreen();
    expect(screen.getByLabelText("I’m at")).toBeInTheDocument();
    expect(screen.getByText("You have no copy yet, so set your place by hand.")).toBeInTheDocument();
  });

  it("has no hand-set hint when the member has a copy", () => {
    renderScreen({ copy: { bookId: "b", confidence: 1 } });
    expect(screen.queryByText(/set your place by hand/)).not.toBeInTheDocument();
  });

  it("calls setManualProgress with the chosen chapter", async () => {
    renderScreen();
    await userEvent.selectOptions(screen.getByLabelText("I’m at"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Set" }));
    await vi.waitFor(() => expect(h.setManualProgress).toHaveBeenCalledTimes(1));
    const [userId, readId, position, client] = h.setManualProgress.mock.calls[0];
    expect([userId, readId, position]).toEqual(["u1", "r1", { chapterIndex: 2, chapterFraction: 0 }]);
    expect(client).toMatchObject(h.client);
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(h.refresh).toHaveBeenCalled();
  });

  it("does not submit until a chapter is chosen", () => {
    renderScreen();
    expect(screen.getByRole("button", { name: "Set" })).toBeDisabled();
  });

  it("shows the error when saving fails", async () => {
    h.setManualProgress.mockRejectedValue(new Error("Could not save your place."));
    renderScreen();
    await userEvent.selectOptions(screen.getByLabelText("I’m at"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your place.");
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("does not name unreached Parts in the chapter picker", () => {
    renderScreen();
    const select = screen.getByLabelText("I’m at");
    const groups = Array.from(select.querySelectorAll("optgroup")).map((g) => g.label);
    expect(groups).toEqual(["Part 1", "Part 2"]);
  });
});
