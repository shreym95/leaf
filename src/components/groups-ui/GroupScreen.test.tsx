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
];
const reads = [{ id: "r1", title: "Middlemarch", author: "George Eliot" }];

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
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.push.mockReset();
  h.refresh.mockReset();
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ url: "/invite/tok123", expiresAt: "2026-10-18T12:00:00.000Z" }),
  });
  vi.stubGlobal("fetch", fetchMock);
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GroupScreen as owner", () => {
  it("shows rename, invite, remove and leave controls", () => {
    renderScreen("u1");
    expect(screen.getByRole("heading", { name: "Tuesday club" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Ben" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave group" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Middlemarch" })).toBeInTheDocument();
  });

  it("copies an absolute invite URL and reports the expiry", async () => {
    renderScreen("u1");
    await userEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toBe(`${window.location.origin}/invite/tok123`);
    expect(new URL(copied).protocol).toMatch(/^https?:$/);
    expect(fetchMock).toHaveBeenCalledWith("/api/groups/g1/invites", { method: "POST" });
    expect(await screen.findByText(/^Link copied\. Expires .+\.$/)).toBeInTheDocument();
  });

  it("shows the link to copy by hand when the clipboard fails", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderScreen("u1");
    await userEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    const field = await screen.findByLabelText(/could not copy/i);
    expect(field).toHaveValue(`${window.location.origin}/invite/tok123`);
  });

  it("shows the server message when the invite call fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "The group is full." }),
    });
    renderScreen("u1");
    await userEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The group is full.");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("asks before removing a member, then calls the route", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    renderScreen("u1");
    await userEvent.click(screen.getByRole("button", { name: "Remove Ben" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Ben?" });
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/groups/g1/members/u2", {
        method: "DELETE",
      }),
    );
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());
  });

  it("cancelling the remove dialog makes no request", async () => {
    renderScreen("u1");
    await userEvent.click(screen.getByRole("button", { name: "Remove Ben" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renames through PATCH after validating", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ group: {} }) });
    renderScreen("u1");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename group" });
    const input = within(dialog).getByLabelText("Name");
    expect(input).toHaveValue("Tuesday club");
    await userEvent.clear(input);
    await userEvent.type(input, "Friday club");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/groups/g1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Friday club" }),
      }),
    );
  });
});

describe("GroupScreen as member", () => {
  it("hides the owner-only controls", () => {
    renderScreen("u2");
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy invite link" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Leave group" })).toBeInTheDocument();
  });

  it("requires confirmation to leave, then goes to /groups", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    renderScreen("u2");
    await userEvent.click(screen.getByRole("button", { name: "Leave group" }));
    const dialog = await screen.findByRole("dialog", { name: "Leave this group?" });
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Leave group" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/groups/g1/members/me", {
        method: "DELETE",
      }),
    );
    await vi.waitFor(() => expect(h.push).toHaveBeenCalledWith("/groups"));
  });

  it("stays on the page and shows the error when leaving fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Could not leave the group." }),
    });
    renderScreen("u2");
    await userEvent.click(screen.getByRole("button", { name: "Leave group" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Leave group" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Could not leave the group.",
    );
    expect(h.push).not.toHaveBeenCalled();
  });
});
