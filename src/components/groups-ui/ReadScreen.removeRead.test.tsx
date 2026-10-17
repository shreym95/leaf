import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Outline } from "@/lib/groups/types";
import type { GroupMemberName } from "@/lib/types";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/db/groups", () => ({ setManualProgress: vi.fn() }));
vi.mock("./useOwnBooks", () => ({ useOwnBooks: () => ({ kind: "idle" }) }));

import { ReadScreen } from "./ReadScreen";

const outline: Outline = [
  { index: 0, label: "Chapter 1", depth: 0, partIndex: null, partLabel: null, href: "a" },
];
const members: GroupMemberName[] = [
  { user_id: "u1", display_name: "Ada", role: "owner", joined_at: "2026-01-01" },
  { user_id: "u2", display_name: "Ben", role: "member", joined_at: "2026-01-02" },
  { user_id: "u3", display_name: "Cy", role: "member", joined_at: "2026-01-03" },
];

function renderScreen(currentUserId: string, createdBy: string | null = "u2") {
  return render(
    <ReadScreen
      groupId="g1"
      groupName="Tuesday club"
      currentUserId={currentUserId}
      read={{
        id: "r1",
        title: "Middlemarch",
        author: "George Eliot",
        source: "standardebooks",
        outline,
        createdBy,
      }}
      members={members}
      progress={[]}
      milestones={[]}
      copy={null}
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

const removeBtn = { name: "Remove book" };

describe("ReadScreen remove this book", () => {
  it("shows Remove book to the owner", () => {
    renderScreen("u1");
    expect(screen.getByRole("button", removeBtn)).toBeInTheDocument();
  });

  it("shows Remove book to the member who added the read", () => {
    renderScreen("u2");
    expect(screen.getByRole("button", removeBtn)).toBeInTheDocument();
  });

  it("hides Remove book from another member", () => {
    renderScreen("u3");
    expect(screen.queryByRole("button", removeBtn)).toBeNull();
  });

  it("hides Remove book from a member when the creator is unknown", () => {
    renderScreen("u3", null);
    expect(screen.queryByRole("button", removeBtn)).toBeNull();
  });

  it("confirms, DELETEs, then goes back to the group screen", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    renderScreen("u2");
    await userEvent.click(screen.getByRole("button", removeBtn));
    const dialog = await screen.findByRole("dialog", {
      name: "Remove this book from the group?",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/groups/g1/reads/r1", {
        method: "DELETE",
      }),
    );
    await vi.waitFor(() => expect(h.push).toHaveBeenCalledWith("/groups/g1"));
    expect(h.refresh).toHaveBeenCalled();
  });

  it("stays on the page and shows the error on failure", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    renderScreen("u1");
    await userEvent.click(screen.getByRole("button", removeBtn));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn't remove the book. Try again.",
    );
    expect(h.push).not.toHaveBeenCalled();
  });
});
