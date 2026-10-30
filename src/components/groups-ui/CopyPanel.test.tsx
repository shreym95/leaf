import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopyPanel, type CopyPanelProps } from "./CopyPanel";

afterEach(cleanup);

function renderPanel(overrides: Partial<CopyPanelProps> = {}) {
  const props: CopyPanelProps = {
    state: { kind: "have", bookId: "b1", confidence: 0.9, title: "Middlemarch", readTitle: "Middlemarch" },
    pending: false,
    added: false,
    error: null,
    onAddCatalog: vi.fn(),
    onChoose: vi.fn(),
    onChange: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  render(<CopyPanel {...props} />);
  return props;
}

describe("CopyPanel with a linked copy", () => {
  it("shows which book is linked", () => {
    renderPanel();
    expect(screen.getByText("Linked: Middlemarch")).toBeInTheDocument();
  });

  it("omits the linked line when the title is null", () => {
    renderPanel({
      state: { kind: "have", bookId: "b1", confidence: null, title: null, readTitle: "Middlemarch" },
    });
    expect(screen.queryByText(/Linked:/)).toBeNull();
    expect(screen.getByRole("link", { name: "Open book" })).toHaveAttribute(
      "href",
      "/reader/b1",
    );
  });

  it("offers Open book, Change copy and Remove copy", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: "Open book" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change copy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove copy" })).toBeInTheDocument();
  });

  it("calls onChange and onRemove from the two actions", async () => {
    const props = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Change copy" }));
    expect(props.onChange).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Remove copy" }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
    expect(props.onChoose).not.toHaveBeenCalled();
  });

  it("keeps the low-confidence message", () => {
    renderPanel({
      state: { kind: "have", bookId: "b1", confidence: 0.4, title: "Middlemarch", readTitle: "Middlemarch" },
    });
    expect(screen.getByText(/chapters don.t fully match/)).toBeInTheDocument();
  });

  it("disables the actions while pending", () => {
    renderPanel({ pending: true });
    expect(screen.getByRole("button", { name: "Change copy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove copy" })).toBeDisabled();
  });
});

describe("CopyPanel without a copy", () => {
  it("shows no change or remove actions", () => {
    renderPanel({ state: { kind: "upload" } });
    expect(screen.queryByRole("button", { name: "Change copy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove copy" })).toBeNull();
    expect(screen.getByRole("button", { name: "Choose your copy" })).toBeInTheDocument();
  });
});
