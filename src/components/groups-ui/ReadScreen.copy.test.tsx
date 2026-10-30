import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Outline } from "@/lib/groups/types";
import type { GroupMemberName } from "@/lib/types";
import type { OwnBooksState } from "./useOwnBooks";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  addMyCopy: vi.fn(),
  removeMyCopy: vi.fn(),
  deleteOwnBook: vi.fn(),
  uploadEpub: vi.fn(),
  trackUpload: vi.fn(),
  ownBooks: { kind: "idle" } as OwnBooksState,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/db/groups", () => ({ setManualProgress: vi.fn() }));
vi.mock("@/lib/upload-client", () => ({ uploadEpub: h.uploadEpub }));
vi.mock("@/lib/analytics", () => ({ trackUpload: h.trackUpload }));
vi.mock("./useOwnBooks", () => ({ useOwnBooks: () => h.ownBooks }));
vi.mock("./actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actions")>()),
  addMyCopy: h.addMyCopy,
  removeMyCopy: h.removeMyCopy,
  deleteOwnBook: h.deleteOwnBook,
}));

import { ReadScreen } from "./ReadScreen";

const outline: Outline = [
  { index: 0, label: "Chapter 1", depth: 0, partIndex: null, partLabel: null, href: "a" },
];
const members: GroupMemberName[] = [
  { user_id: "u1", display_name: "Ada", role: "owner", joined_at: "2026-01-01" },
  { user_id: "u2", display_name: "Ben", role: "member", joined_at: "2026-01-02" },
];

const library = [
  { id: "b1", title: "Middlemarch", author: "George Eliot", source: "standardebooks" as const, sourceRef: null },
  { id: "b2", title: "Dune", author: "Frank Herbert", source: "upload" as const, sourceRef: null },
];

function renderScreen(copy: { bookId: string; confidence: number | null; title?: string | null } | null) {
  return render(
    <ReadScreen
      groupId="g1"
      groupName="Tuesday club"
      currentUserId="u2"
      read={{
        id: "r1",
        title: "Middlemarch",
        author: "George Eliot",
        source: "standardebooks",
        outline,
        createdBy: "u2",
      }}
      members={members}
      progress={[]}
      milestones={[]}
      copy={copy}
    />,
  );
}

const linked = { bookId: "b1", confidence: 0.9, title: "Middlemarch" };

beforeEach(() => {
  h.push.mockReset();
  h.refresh.mockReset();
  h.addMyCopy.mockReset().mockResolvedValue({ confidence: null });
  h.removeMyCopy.mockReset().mockResolvedValue(undefined);
  h.deleteOwnBook.mockReset().mockResolvedValue(undefined);
  h.uploadEpub.mockReset();
  h.trackUpload.mockReset();
  h.ownBooks = { kind: "ready", books: library };
});

afterEach(() => {
  cleanup();
});

describe("ReadScreen linked copy", () => {
  it("shows the linked title and the change and remove actions", () => {
    renderScreen(linked);
    expect(screen.getByText("Linked: Middlemarch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change copy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove copy" })).toBeInTheDocument();
  });
});

describe("ReadScreen remove copy", () => {
  it("without the checkbox, only unlinks the copy", async () => {
    renderScreen(linked);
    await userEvent.click(screen.getByRole("button", { name: "Remove copy" }));
    const dialog = screen.getByRole("dialog", { name: "Remove your copy?" });
    expect(within(dialog).getByRole("checkbox")).not.toBeChecked();

    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await vi.waitFor(() => expect(h.removeMyCopy).toHaveBeenCalledWith("g1", "r1"));
    expect(h.deleteOwnBook).not.toHaveBeenCalled();
    expect(h.refresh).toHaveBeenCalled();
  });

  it("with the checkbox, unlinks then deletes the book", async () => {
    renderScreen(linked);
    await userEvent.click(screen.getByRole("button", { name: "Remove copy" }));
    const dialog = screen.getByRole("dialog", { name: "Remove your copy?" });
    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: "Also delete this book from my library" }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await vi.waitFor(() => expect(h.deleteOwnBook).toHaveBeenCalledWith("b1"));
    expect(h.removeMyCopy).toHaveBeenCalledWith("g1", "r1");
    expect(h.removeMyCopy.mock.invocationCallOrder[0]).toBeLessThan(
      h.deleteOwnBook.mock.invocationCallOrder[0],
    );
  });

  it("resets the checkbox to off when the dialog is closed", async () => {
    renderScreen(linked);
    await userEvent.click(screen.getByRole("button", { name: "Remove copy" }));
    let dialog = screen.getByRole("dialog", { name: "Remove your copy?" });
    await userEvent.click(within(dialog).getByRole("checkbox"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Remove your copy?" })).toBeNull(),
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove copy" }));
    dialog = screen.getByRole("dialog", { name: "Remove your copy?" });
    expect(within(dialog).getByRole("checkbox")).not.toBeChecked();
    expect(h.removeMyCopy).not.toHaveBeenCalled();
  });

  it("shows the failure inside the dialog and does not delete the book", async () => {
    h.removeMyCopy.mockRejectedValue(new Error("Couldn't remove your copy. Try again."));
    renderScreen(linked);
    await userEvent.click(screen.getByRole("button", { name: "Remove copy" }));
    const dialog = screen.getByRole("dialog", { name: "Remove your copy?" });
    await userEvent.click(within(dialog).getByRole("checkbox"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn't remove your copy. Try again.",
    );
    expect(h.deleteOwnBook).not.toHaveBeenCalled();
  });
});

describe("ReadScreen change copy", () => {
  it("opens the picker titled for a change and leaves out the linked book", async () => {
    renderScreen(linked);
    await userEvent.click(screen.getByRole("button", { name: "Change copy" }));
    const dialog = screen.getByRole("dialog", { name: "Change your copy" });
    expect(within(dialog).queryByRole("button", { name: /Middlemarch/ })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /Dune/ })).toBeInTheDocument();
  });

  it("links the picked book as the new copy", async () => {
    renderScreen(linked);
    await userEvent.click(screen.getByRole("button", { name: "Change copy" }));
    const dialog = screen.getByRole("dialog", { name: "Change your copy" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Dune/ }));

    await vi.waitFor(() => expect(h.addMyCopy).toHaveBeenCalledWith("g1", "r1", "b2"));
    expect(h.refresh).toHaveBeenCalled();
  });

  it("uploads a new EPUB, tracks it, and links it as the copy", async () => {
    h.uploadEpub.mockResolvedValue({ id: "b9", title: "New zine" });
    renderScreen(linked);
    await userEvent.click(screen.getByRole("button", { name: "Change copy" }));
    const dialog = screen.getByRole("dialog", { name: "Change your copy" });
    const input = within(dialog).getByLabelText("Upload an EPUB file") as HTMLInputElement;
    const file = new File(["x"], "zine.epub", { type: "application/epub+zip" });

    await userEvent.upload(input, file);

    await vi.waitFor(() => expect(h.addMyCopy).toHaveBeenCalledWith("g1", "r1", "b9"));
    expect(h.uploadEpub).toHaveBeenCalledWith(file);
    expect(h.trackUpload).toHaveBeenCalledTimes(1);
    expect(h.uploadEpub.mock.invocationCallOrder[0]).toBeLessThan(
      h.addMyCopy.mock.invocationCallOrder[0],
    );
  });
});
