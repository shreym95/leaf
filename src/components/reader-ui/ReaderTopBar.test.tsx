import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReaderTopBar } from "./ReaderTopBar";

describe("ReaderTopBar", () => {
  it("keeps a way back to the library", () => {
    render(
      <ReaderTopBar
        immersive={false}
        overlay={false}
        hidden={false}
        onToggleImmersive={() => {}}
      />,
    );
    expect(screen.getByRole("link", { name: /library/i })).toHaveAttribute(
      "href",
      "/library",
    );
  });

  it("offers a fullscreen control that names the action it will take", () => {
    // The only touch route into immersive: the deck has no pod for it and a
    // phone has no `F` key, so without this control fullscreen is unreachable
    // on the device it matters most on.
    const { rerender } = render(
      <ReaderTopBar
        immersive={false}
        overlay={false}
        hidden={false}
        onToggleImmersive={() => {}}
      />,
    );
    const enter = screen.getByRole("button", { name: "Enter full screen" });
    expect(enter).toHaveAttribute("aria-pressed", "false");

    rerender(
      <ReaderTopBar immersive overlay hidden={false} onToggleImmersive={() => {}} />,
    );
    expect(
      screen.getByRole("button", { name: "Exit full screen" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles immersive on click", async () => {
    const user = userEvent.setup();
    const onToggleImmersive = vi.fn();
    render(
      <ReaderTopBar
        immersive={false}
        overlay={false}
        hidden={false}
        onToggleImmersive={onToggleImmersive}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Enter full screen" }));
    expect(onToggleImmersive).toHaveBeenCalledTimes(1);
  });

  it("floats out of the flow in fullscreen, so nothing reflows", () => {
    // Rendering null and re-mounting into the flow made opening the deck shrink
    // the frame by the bar's height: the prose jumped and epub.js repaginated.
    const { container } = render(
      <ReaderTopBar immersive overlay hidden onToggleImmersive={() => {}} />,
    );
    const header = container.querySelector("header");
    expect(header?.className).toContain("absolute");
    expect(header?.className).not.toContain("flex-none");
    // Still mounted — out of flow it costs no height, so it only fades.
    expect(header).not.toBeNull();
    expect(header).toHaveAttribute("aria-hidden", "true");
  });

  it("stays in the flow when not in fullscreen", () => {
    const { container } = render(
      <ReaderTopBar
        immersive={false}
        overlay={false}
        hidden={false}
        onToggleImmersive={() => {}}
      />,
    );
    expect(container.querySelector("header")?.className).toContain("flex-none");
  });
});
