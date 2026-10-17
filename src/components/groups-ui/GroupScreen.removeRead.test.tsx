import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GroupMemberName } from "@/lib/types";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
}));

import { GroupScreen } from "./GroupScreen";

const members: GroupMemberName[] = [
  { user_id: "u1", display_name: "Ada", role: "owner", joined_at: "2026-01-01" },
  { user_id: "u2", display_name: "Ben", role: "member", joined_at: "2026-01-02" },
  { user_id: "u3", display_name: "Cy", role: "member", joined_at: "2026-01-03" },
];
const reads = [
  { id: "r1", title: "Middlemarch", author: "George Eliot", createdBy: "u2" },
  { id: "r2", title: "Emma", author: "Jane Austen", createdBy: "u3" },
  { id: "r3", title: "Orphaned", author: "Nobody", createdBy: null },
];

function renderScreen(currentUserId: string) {
  return render(
    <GroupScreen
      groupId="g1"
      name="Tuesday club"
      currentUserId={currentUserId}
      members={members}
      reads={reads}
    />,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.push.mockReset();
  h.refresh.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const removeBook = (title: string) => ({ name: `Remove ${title}` });

describe("GroupScreen remove a book", () => {
  it("shows Remove on every book to the owner", () => {
    renderScreen("u1");
    expect(screen.getByRole("button", removeBook("Middlemarch"))).toBeInTheDocument();
    expect(screen.getByRole("button", removeBook("Emma"))).toBeInTheDocument();
    expect(screen.getByRole("button", removeBook("Orphaned"))).toBeInTheDocument();
  });

  it("shows Remove to a plain member only on the books they added", () => {
    renderScreen("u2");
    expect(screen.getByRole("button", removeBook("Middlemarch"))).toBeInTheDocument();
    expect(screen.queryByRole("button", removeBook("Emma"))).toBeNull();
    expect(screen.queryByRole("button", removeBook("Orphaned"))).toBeNull();
  });

  it("shows no book Remove to a member who added none", () => {
    cleanup();
    render(
      <GroupScreen
        groupId="g1"
        name="Tuesday club"
        currentUserId="u2"
        members={members}
        reads={[reads[1], reads[2]]}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Remove (Emma|Orphaned)$/ })).toBeNull();
  });

  it("asks first, then DELETEs the read and refreshes", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    renderScreen("u2");
    await userEvent.click(screen.getByRole("button", removeBook("Middlemarch")));
    const dialog = await screen.findByRole("dialog", {
      name: "Remove this book from the group?",
    });
    expect(
      within(dialog).getByText(
        "Everyone's progress and milestones for it will be deleted. Your own copy stays in your library.",
      ),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/groups/g1/reads/r1", {
        method: "DELETE",
      }),
    );
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cancelling makes no request", async () => {
    renderScreen("u1");
    await userEvent.click(screen.getByRole("button", removeBook("Emma")));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("shows the error and does not refresh when the server refuses", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "server detail that must not leak" }),
    });
    renderScreen("u1");
    await userEvent.click(screen.getByRole("button", removeBook("Emma")));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn't remove the book. Try again.",
    );
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("shows the same error when the network fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    renderScreen("u1");
    await userEvent.click(screen.getByRole("button", removeBook("Emma")));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn't remove the book. Try again.",
    );
    expect(h.refresh).not.toHaveBeenCalled();
  });
});
