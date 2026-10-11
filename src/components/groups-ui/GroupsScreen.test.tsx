import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: vi.fn() }),
}));

import { GroupsScreen } from "./GroupsScreen";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.push.mockReset();
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ group: { id: "g9", name: "Club" } }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GroupsScreen", () => {
  it("shows one line and the button when there are no groups", () => {
    render(<GroupsScreen groups={[]} />);
    expect(screen.getByRole("heading", { name: "Groups" })).toBeInTheDocument();
    expect(screen.getByText("No groups yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New group" })).toBeInTheDocument();
  });

  it("lists groups", () => {
    render(
      <GroupsScreen
        groups={[{ id: "g1", name: "Tuesday club", memberCount: 2, role: "owner" }]}
      />,
    );
    expect(screen.queryByText("No groups yet.")).toBeNull();
    expect(screen.getByRole("link", { name: /tuesday club/i })).toBeInTheDocument();
  });

  it("creates a group and opens its page", async () => {
    render(<GroupsScreen groups={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "New group" }));
    const dialog = await screen.findByRole("dialog", { name: "New group" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Club");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Club" }),
      }),
    );
    await vi.waitFor(() => expect(h.push).toHaveBeenCalledWith("/groups/g9"));
  });

  it("does not call the route for an empty name", async () => {
    render(<GroupsScreen groups={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "New group" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(within(dialog).getByRole("alert")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
