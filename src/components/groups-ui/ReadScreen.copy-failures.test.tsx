import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Outline } from "@/lib/groups/types";
import type { GroupMemberName } from "@/lib/types";
import type { ReadScreenProps } from "./ReadScreen";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  addMyCopy: vi.fn(),
  removeMyCopy: vi.fn(),
  deleteOwnBook: vi.fn(),
  uploadEpub: vi.fn(),
  trackUpload: vi.fn(),
  useOwnBooks: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/db/groups", () => ({ setManualProgress: vi.fn() }));
vi.mock("@/lib/upload-client", () => ({ uploadEpub: h.uploadEpub }));
vi.mock("@/lib/analytics", () => ({ trackUpload: h.trackUpload }));
vi.mock("./useOwnBooks", () => ({
  useOwnBooks: (...args: unknown[]) => h.useOwnBooks(...args),
}));
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
const uploaded = { id: "b9", title: "New zine", author: "", source: "upload" as const, sourceRef: null };

const linked = { bookId: "b1", confidence: 0.9, title: "Middlemarch" };
const DELETE_ERROR = "Couldn't delete the book from your library.";

type CopyProp = ReadScreenProps["copy"];

function screenProps(copy: CopyProp): ReadScreenProps {
  return {
    groupId: "g1",
    groupName: "Tuesday club",
    currentUserId: "u2",
    read: {
      id: "r1",
      title: "Middlemarch",
      author: "George Eliot",
      source: "standardebooks",
      outline,
      createdBy: "u2",
    },
    members,
    progress: [],
    milestones: [],
    copy,
  };
}

function renderScreen(copy: CopyProp) {
  const view = render(<ReadScreen {...screenProps(copy)} />);
  return {
    /** Re-render as the page does after a router refresh. */
    rerenderWith: (next: CopyProp) => view.rerender(<ReadScreen {...screenProps(next)} />),
  };
}

function removeDialog() {
  return screen.getByRole("dialog", { name: "Remove your copy?" });
}

async function openRemoveWithDelete() {
  await userEvent.click(screen.getByRole("button", { name: "Remove copy" }));
  await userEvent.click(within(removeDialog()).getByRole("checkbox"));
  await userEvent.click(within(removeDialog()).getByRole("button", { name: "Remove" }));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  h.push.mockReset();
  h.refresh.mockReset();
  h.addMyCopy.mockReset().mockResolvedValue({ confidence: null });
  h.removeMyCopy.mockReset().mockResolvedValue(undefined);
  h.deleteOwnBook.mockReset().mockResolvedValue(undefined);
  h.uploadEpub.mockReset();
  h.trackUpload.mockReset();
  h.useOwnBooks.mockReset().mockImplementation(
    (_userId: string, _enabled: boolean, version = 0) => ({
      kind: "ready",
      books: version > 0 ? [...library, uploaded] : library,
    }),
  );
});

afterEach(() => {
  cleanup();
});

describe("ReadScreen remove copy after a failed delete", () => {
  it("retries only the delete with the original id when the page re-rendered unlinked", async () => {
    h.deleteOwnBook
      .mockRejectedValueOnce(new Error(DELETE_ERROR))
      .mockResolvedValueOnce(undefined);
    const view = renderScreen(linked);

    await openRemoveWithDelete();
    expect(await within(removeDialog()).findByRole("alert")).toHaveTextContent(DELETE_ERROR);
    expect(h.removeMyCopy).toHaveBeenCalledTimes(1);
    expect(h.refresh).not.toHaveBeenCalled();

    // The unlink went through, so the page now shows no copy.
    view.rerenderWith(null);

    await userEvent.click(within(removeDialog()).getByRole("button", { name: "Remove" }));

    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Remove your copy?" })).toBeNull(),
    );
    expect(h.deleteOwnBook).toHaveBeenCalledTimes(2);
    expect(h.deleteOwnBook).toHaveBeenNthCalledWith(1, "b1");
    expect(h.deleteOwnBook).toHaveBeenNthCalledWith(2, "b1");
    expect(h.removeMyCopy).toHaveBeenCalledTimes(1);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes the page once cancelled after the unlink succeeded", async () => {
    h.deleteOwnBook.mockRejectedValueOnce(new Error(DELETE_ERROR));
    renderScreen(linked);

    await openRemoveWithDelete();
    expect(await within(removeDialog()).findByRole("alert")).toHaveTextContent(DELETE_ERROR);
    expect(h.refresh).not.toHaveBeenCalled();

    await userEvent.click(within(removeDialog()).getByRole("button", { name: "Cancel" }));

    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Remove your copy?" })).toBeNull(),
    );
    expect(h.removeMyCopy).toHaveBeenCalledTimes(1);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh while the delete is pending, and refreshes once on success", async () => {
    const pending = deferred();
    h.deleteOwnBook.mockReturnValueOnce(pending.promise);
    renderScreen(linked);

    await openRemoveWithDelete();
    await vi.waitFor(() => expect(h.deleteOwnBook).toHaveBeenCalledWith("b1"));
    expect(h.refresh).not.toHaveBeenCalled();

    pending.resolve();

    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Remove your copy?" })).toBeNull(),
    );
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("ReadScreen upload that uploads but does not link", () => {
  it("says the book is in the library but unlinked, and reloads the picker list", async () => {
    h.uploadEpub.mockResolvedValue({ id: "b9", title: "New zine" });
    h.addMyCopy.mockRejectedValue(new Error("Could not add your copy."));
    renderScreen(linked);

    await userEvent.click(screen.getByRole("button", { name: "Change copy" }));
    const picker = screen.getByRole("dialog", { name: "Change your copy" });
    const file = new File(["x"], "zine.epub", { type: "application/epub+zip" });
    await userEvent.upload(within(picker).getByLabelText("Upload an EPUB file"), file);

    expect(await within(picker).findByRole("alert")).toHaveTextContent(
      "Uploaded to your library, but couldn't link it. Choose it from your books to try again.",
    );
    expect(h.uploadEpub).toHaveBeenCalledTimes(1);
    expect(h.addMyCopy).toHaveBeenCalledTimes(1);
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.useOwnBooks).toHaveBeenLastCalledWith("u2", true, 1);
    expect(
      screen.getByRole("dialog", { name: "Change your copy" }),
    ).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: /New zine/ })).toBeInTheDocument();
  });
});
