import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders a calm headline", () => {
    render(<EmptyState />);
    expect(
      screen.getByRole("heading", { name: /your shelf is empty/i }),
    ).toBeInTheDocument();
  });

  it("notes that import + upload arrive in M2", () => {
    render(<EmptyState />);
    expect(screen.getByText(/arrive in M2/i)).toBeInTheDocument();
  });

  it("renders no dead button or link", () => {
    render(<EmptyState />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
