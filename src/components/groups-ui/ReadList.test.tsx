import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReadList } from "./ReadList";

afterEach(cleanup);

describe("ReadList", () => {
  it("links each read to its page with title and author", () => {
    render(
      <ReadList
        groupId="g1"
        reads={[{ id: "r1", title: "Middlemarch", author: "George Eliot" }]}
      />,
    );
    expect(screen.getByRole("link", { name: "Middlemarch" })).toHaveAttribute(
      "href",
      "/groups/g1/reads/r1",
    );
    expect(screen.getByText("George Eliot")).toBeInTheDocument();
  });

  it("shows one plain line when there are no reads", () => {
    render(<ReadList groupId="g1" reads={[]} />);
    expect(screen.getByText("No reads yet.")).toBeInTheDocument();
  });
});
