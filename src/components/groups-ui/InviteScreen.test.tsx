import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";

const h = vi.hoisted(() => {
  const replace = vi.fn();
  // Stable identity, like the real router.
  return { replace, router: { replace } };
});

vi.mock("next/navigation", () => ({
  useRouter: () => h.router,
}));

import { InviteScreen } from "./InviteScreen";

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderScreen() {
  return render(
    <StrictMode>
      <InviteScreen token="tok123" />
    </StrictMode>,
  );
}

beforeEach(() => {
  h.replace.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InviteScreen", () => {
  it("posts accept once, even under strict mode, and shows Joining…", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderScreen();
    expect(screen.getByRole("status")).toHaveTextContent("Joining…");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/invites/tok123/accept", {
      method: "POST",
    });
  });

  it("goes to the group on success", async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        groupId: "g1",
        alreadyMember: false,
        linked: 0,
        imported: 1,
        failed: [],
      }),
    );
    renderScreen();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/groups/g1"));
    expect(h.replace).toHaveBeenCalledTimes(1);
  });

  it("still goes to the group when some imports failed, with no message", async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        groupId: "g1",
        alreadyMember: false,
        linked: 0,
        imported: 0,
        failed: [{ readId: "r1", title: "Middlemarch" }],
      }),
    );
    renderScreen();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/groups/g1"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [404, "This invite link is not valid."],
    [410, "This invite has expired."],
    [409, "This group is full."],
  ])("shows the line for %i with a Groups link and no retry", async (status, line) => {
    fetchMock.mockResolvedValue(reply(status, { error: "server text" }));
    renderScreen();
    expect(await screen.findByRole("alert")).toHaveTextContent(line);
    expect(screen.getByRole("link", { name: "Groups" })).toHaveAttribute(
      "href",
      "/groups",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("shows the generic line with Try again for other failures, and re-posts", async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { error: "boom" }));
    renderScreen();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not join the group. Try again.",
    );
    expect(screen.getByRole("link", { name: "Groups" })).toHaveAttribute(
      "href",
      "/groups",
    );

    fetchMock.mockResolvedValueOnce(reply(200, { groupId: "g9" }));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/groups/g9"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a network failure as the generic retryable error", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    renderScreen();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not join the group. Try again.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
