import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GroupMemberName } from "@/lib/types";
import { MemberList } from "./MemberList";

afterEach(cleanup);

const members: GroupMemberName[] = [
  { user_id: "u1", display_name: "Ada", role: "owner", joined_at: "2026-01-01" },
  { user_id: "u2", display_name: "Ben", role: "member", joined_at: "2026-01-02" },
  { user_id: "u3", display_name: null, role: "member", joined_at: "2026-01-03" },
];

describe("MemberList", () => {
  it("shows names, a Reader fallback, and the Owner marker", () => {
    render(
      <MemberList
        members={members}
        currentUserId="u2"
        canRemove={false}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Reader")).toBeInTheDocument();
    expect(screen.getAllByText("Owner")).toHaveLength(1);
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("hides Remove for non-owners", () => {
    render(
      <MemberList
        members={members}
        currentUserId="u2"
        canRemove={false}
        onRemove={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("owner can remove others but not themselves", async () => {
    const onRemove = vi.fn();
    render(
      <MemberList
        members={members}
        currentUserId="u1"
        canRemove
        onRemove={onRemove}
      />,
    );
    expect(screen.getAllByRole("button", { name: /^remove/i })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Remove Ada" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Remove Ben" }));
    expect(onRemove).toHaveBeenCalledWith(members[1]);
  });
});
