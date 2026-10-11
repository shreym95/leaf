import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GroupList } from "./GroupList";

afterEach(cleanup);

describe("GroupList", () => {
  it("renders name, member count and role as a link to the group", () => {
    render(
      <GroupList
        groups={[
          { id: "g1", name: "Tuesday club", memberCount: 3, role: "owner" },
          { id: "g2", name: "Poetry", memberCount: 1, role: "member" },
        ]}
      />,
    );
    const first = screen.getByRole("link", { name: /tuesday club/i });
    expect(first).toHaveAttribute("href", "/groups/g1");
    expect(first).toHaveTextContent("3 members");
    expect(first).toHaveTextContent("Owner");
    const second = screen.getByRole("link", { name: /poetry/i });
    expect(second).toHaveTextContent("1 member");
    expect(second).not.toHaveTextContent("1 members");
    expect(second).toHaveTextContent("Member");
  });
});
