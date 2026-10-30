import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CopyPanel, type CopyPanelProps } from "./CopyPanel";

afterEach(cleanup);

function renderLinked(title: string | null, readTitle: string) {
  const props: CopyPanelProps = {
    state: { kind: "have", bookId: "b1", confidence: 0.9, title, readTitle },
    pending: false,
    added: false,
    error: null,
    onAddCatalog: vi.fn(),
    onChoose: vi.fn(),
    onChange: vi.fn(),
    onRemove: vi.fn(),
  };
  render(<CopyPanel {...props} />);
}

describe("CopyPanel wrong-book nudge", () => {
  it("shows a quiet note when the linked title differs from the group read", () => {
    renderLinked("Dune", "Middlemarch");

    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(
      "This doesn’t look like Middlemarch. If it’s the wrong book, use Change copy.",
    );
    expect(note.querySelector("em")).toHaveTextContent("Middlemarch");
  });

  it("hides the note when the titles match, ignoring article, case and subtitle", () => {
    renderLinked("The Dracula", "dracula: a novel");

    expect(screen.getByText("Linked: The Dracula")).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("hides the note when the linked title is null", () => {
    renderLinked(null, "Middlemarch");

    expect(screen.queryByRole("note")).toBeNull();
  });
});
