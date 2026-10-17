import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { ReaderTopBar, type ReaderTopBarProps } from "./ReaderTopBar";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderBar(over: Partial<ReaderTopBarProps> = {}) {
  const props: ReaderTopBarProps = {
    immersive: false,
    overlay: false,
    hidden: false,
    onToggleImmersive: vi.fn(),
    ...over,
  };
  return render(<ReaderTopBar {...props} />);
}

describe("ReaderTopBar slot", () => {
  it("shows its own controls when no slot is given", () => {
    renderBar();
    expect(screen.getByRole("link", { name: /Library/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter full screen" })).toBeInTheDocument();
    expect(document.querySelector("[data-bar-slot]")).toBeNull();
  });

  it("replaces its contents with the slot while one is given", () => {
    renderBar({ slot: <div role="toolbar" aria-label="Selected text actions">bar</div> });
    expect(screen.getByRole("toolbar", { name: "Selected text actions" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Library/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enter full screen" })).toBeNull();
  });

  it("returns the default controls once the slot is cleared", () => {
    const { rerender } = render(
      <ReaderTopBar
        immersive={false}
        overlay={false}
        hidden={false}
        onToggleImmersive={vi.fn()}
        slot={<span>bar</span>}
      />,
    );
    rerender(
      <ReaderTopBar immersive={false} overlay={false} hidden={false} onToggleImmersive={vi.fn()} />,
    );
    expect(screen.getByRole("link", { name: /Library/ })).toBeInTheDocument();
    expect(screen.queryByText("bar")).toBeNull();
  });

  it("keeps the slot to one line tall, the height of the default row", () => {
    renderBar({ slot: <span>bar</span> });
    const host = document.querySelector("[data-bar-slot]") as HTMLElement;
    expect(host.style.height).toBe("1lh");
  });

  it("keeps the header landmark and reader-chrome marker in both states", () => {
    const { container } = renderBar({ slot: <span>bar</span> });
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header).toHaveAttribute("data-reader-chrome");
  });
});
