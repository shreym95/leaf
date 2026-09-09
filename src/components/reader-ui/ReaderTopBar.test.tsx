import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReaderTopBar } from "./ReaderTopBar";

describe("ReaderTopBar", () => {
  it("keeps a way back to the library", () => {
    render(<ReaderTopBar immersive={false} onToggleImmersive={() => {}} />);
    expect(screen.getByRole("link", { name: /library/i })).toHaveAttribute(
      "href",
      "/library",
    );
  });

  it("offers a fullscreen control that names the action it will take", () => {
    // The only touch route into immersive: the dock has no pod for it and a
    // phone has no `F` key, so without this control fullscreen is unreachable
    // on the device it matters most on.
    const { rerender } = render(
      <ReaderTopBar immersive={false} onToggleImmersive={() => {}} />,
    );
    const enter = screen.getByRole("button", { name: "Enter full screen" });
    expect(enter).toHaveAttribute("aria-pressed", "false");

    rerender(<ReaderTopBar immersive onToggleImmersive={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Exit full screen" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles immersive on click", async () => {
    const user = userEvent.setup();
    const onToggleImmersive = vi.fn();
    render(
      <ReaderTopBar immersive={false} onToggleImmersive={onToggleImmersive} />,
    );
    await user.click(screen.getByRole("button", { name: "Enter full screen" }));
    expect(onToggleImmersive).toHaveBeenCalledTimes(1);
  });
});
