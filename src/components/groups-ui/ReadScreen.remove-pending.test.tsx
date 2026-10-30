import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Outline } from "@/lib/groups/types";
import type { GroupMemberName } from "@/lib/types";
import type { OwnBooksState } from "./useOwnBooks";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  removeMyCopy: vi.fn(),
  deleteOwnBook: vi.fn(),
  ownBooks: { kind: "idle" } as OwnBooksState,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/db/groups", () => ({ setManualProgress: vi.fn() }));
vi.mock("@/lib/upload-client", () => ({ uploadEpub: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackUpload: vi.fn() }));
vi.mock("./useOwnBooks", () => ({ useOwnBooks: () => h.ownBooks }));
vi.mock("./actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actions")>()),
  addMyCopy: vi.fn(),
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

function renderScreen() {
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
      copy={{ bookId: "b1", confidence: 0.9, title: "Middlemarch" }}
    />,
  );
}

beforeEach(() => {
  h.push.mockReset();
  h.refresh.mockReset();
  h.removeMyCopy.mockReset().mockResolvedValue(undefined);
  h.deleteOwnBook.mockReset().mockResolvedValue(undefined);
  h.ownBooks = { kind: "ready", books: [] };
});

afterEach(cleanup);

describe("ReadScreen remove copy while pending", () => {
  it("keeps the dialog open on Escape or Cancel, then deletes the book once, in the visible flow", async () => {
    let finishUnlink!: () => void;
    h.removeMyCopy.mockReturnValue(
      new Promise<void>((resolve) => (finishUnlink = resolve)),
    );
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Remove copy" }));
    const dialog = screen.getByRole("dialog", { name: "Remove your copy?" });
    await userEvent.click(within(dialog).getByRole("checkbox"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Remove your copy?" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog", { name: "Remove your copy?" })).getByRole("button", {
        name: "Cancel",
      }),
    ).toBeDisabled();

    expect(h.removeMyCopy).toHaveBeenCalledWith("g1", "r1");
    expect(h.deleteOwnBook).not.toHaveBeenCalled();

    await act(async () => finishUnlink());

    await vi.waitFor(() => expect(h.deleteOwnBook).toHaveBeenCalledWith("b1"));
    expect(h.deleteOwnBook).toHaveBeenCalledTimes(1);
    expect(h.removeMyCopy.mock.invocationCallOrder[0]).toBeLessThan(
      h.deleteOwnBook.mock.invocationCallOrder[0],
    );
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Remove your copy?" })).toBeNull(),
    );
  });
});
