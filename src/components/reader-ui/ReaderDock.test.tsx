import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReaderDock, type ReaderDockProps } from "./ReaderDock";

const TOC = [
  { href: "ch1.html", label: "Chapter 1" },
  { href: "ch4.html", label: "Chapter 4" },
  { href: "ch5.html", label: "Chapter 5" },
];

function baseProps(over: Partial<ReaderDockProps> = {}): ReaderDockProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    percent: 0.42,
    chapterLabel: "Chapter 4",
    page: 3,
    pageTotal: 12,
    toc: TOC,
    onNavigate: vi.fn(),
    onPrevPage: vi.fn(),
    onNextPage: vi.fn(),
    theme: "night",
    onSetTheme: vi.fn(),
    fontSize: 1.06,
    onSetFontSize: vi.fn(),
    onOpenSettings: vi.fn(),
    ...over,
  };
}

function renderDock(over: Partial<ReaderDockProps> = {}) {
  const props = baseProps(over);
  render(
    <>
      <div data-testid="outside">outside</div>
      <ReaderDock {...props} />
    </>,
  );
  return props;
}

const deck = () => screen.getByRole("region", { name: "Reading controls" });

describe("ReaderDock — resting ⇄ expanded", () => {
  it("resting pill opens the deck", async () => {
    const user = userEvent.setup();
    const props = renderDock({ open: false });
    await user.click(
      screen.getByRole("button", { name: /open reading controls/i }),
    );
    expect(props.onOpenChange).toHaveBeenCalledWith(true);
  });

  it("hides the deck from AT while resting, and the pill while expanded", () => {
    const { rerender } = render(<ReaderDock {...baseProps({ open: false })} />);
    // Resting: the deck is inert + aria-hidden, the pill is reachable.
    expect(
      screen.queryByRole("region", { name: "Reading controls" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /open reading controls/i }),
    ).not.toHaveAttribute("aria-hidden", "true");

    rerender(<ReaderDock {...baseProps({ open: true })} />);
    // Expanded: the region is reachable, the pill is inert + aria-hidden.
    expect(deck()).not.toHaveAttribute("inert");
    expect(
      screen.queryByRole("button", { name: /open reading controls/i }),
    ).toBeNull();
  });

  it("closes via the ✕ pod", async () => {
    const user = userEvent.setup();
    const props = renderDock();
    await user.click(
      within(deck()).getByRole("button", { name: "Close reading controls" }),
    );
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes via Escape", async () => {
    const user = userEvent.setup();
    const props = renderDock();
    await user.keyboard("{Escape}");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes via a tap outside the deck", async () => {
    const user = userEvent.setup();
    const props = renderDock();
    await user.click(screen.getByTestId("outside"));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("ReaderDock — pods", () => {
  it("shows every pod, each with an accessible name", () => {
    renderDock();
    const d = deck();
    expect(within(d).getByRole("switch", { name: "Night theme" })).toBeTruthy();
    expect(within(d).getByRole("group", { name: "Text size" })).toBeTruthy();
    expect(
      within(d).getByRole("button", { name: "Decrease text size" }),
    ).toBeTruthy();
    expect(
      within(d).getByRole("button", { name: "Increase text size" }),
    ).toBeTruthy();
    expect(
      within(d).getByRole("button", { name: "Table of contents" }),
    ).toBeTruthy();
    expect(
      within(d).getByRole("button", { name: "Reading settings" }),
    ).toBeTruthy();
    expect(
      within(d).getByRole("button", { name: "Close reading controls" }),
    ).toBeTruthy();
    expect(
      within(d).getByRole("button", { name: "Previous page" }),
    ).toBeTruthy();
    expect(within(d).getByRole("button", { name: "Next page" })).toBeTruthy();
    expect(
      within(d).getByRole("progressbar", { name: "Reading progress" }),
    ).toHaveAttribute("aria-valuenow", "42");
  });

  it("the ‹ / › page-turn buttons are real, keyboard-reachable, and leave the deck open", async () => {
    const user = userEvent.setup();
    const props = renderDock();
    const prev = within(deck()).getByRole("button", { name: "Previous page" });
    const next = within(deck()).getByRole("button", { name: "Next page" });
    // In the tab order (not tabIndex -1 like the SpreadFrame tap zones).
    expect(prev).toHaveProperty("tabIndex", 0);
    expect(next).toHaveProperty("tabIndex", 0);

    await user.click(next);
    await user.click(prev);
    expect(props.onNextPage).toHaveBeenCalledTimes(1);
    expect(props.onPrevPage).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it("the theme toggle reflects state and flips through the registry", async () => {
    const user = userEvent.setup();
    const props = renderDock({ theme: "night" });
    const toggle = within(deck()).getByRole("switch", { name: "Night theme" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    expect(props.onSetTheme).toHaveBeenCalledWith("day");
  });

  it("the theme toggle switches the other way from the light theme", async () => {
    const user = userEvent.setup();
    const props = renderDock({ theme: "day" });
    const toggle = within(deck()).getByRole("switch", { name: "Night theme" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(props.onSetTheme).toHaveBeenCalledWith("night");
  });

  it("the font stepper nudges the size up and down", async () => {
    const user = userEvent.setup();
    const props = renderDock({ fontSize: 1.06 });
    await user.click(
      within(deck()).getByRole("button", { name: "Increase text size" }),
    );
    expect(props.onSetFontSize).toHaveBeenCalledWith(1.12);
    await user.click(
      within(deck()).getByRole("button", { name: "Decrease text size" }),
    );
    expect(props.onSetFontSize).toHaveBeenCalledWith(1);
  });

  it("the font stepper stops at its bounds", () => {
    render(<ReaderDock {...baseProps({ fontSize: 0.9 })} />);
    expect(
      within(deck()).getByRole("button", { name: "Decrease text size" }),
    ).toBeDisabled();
    expect(
      within(deck()).getByRole("button", { name: "Increase text size" }),
    ).toBeEnabled();
  });

  it("the ⋯ pod opens the settings sheet", async () => {
    const user = userEvent.setup();
    const props = renderDock();
    await user.click(
      within(deck()).getByRole("button", { name: "Reading settings" }),
    );
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

describe("ReaderDock — table of contents popover", () => {
  it("lists the chapters, marks the current one, and navigates on click", async () => {
    const user = userEvent.setup();
    const props = renderDock({ chapterLabel: "Chapter 4" });
    const trigger = within(deck()).getByRole("button", {
      name: "Table of contents",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const popover = screen.getByRole("dialog", { name: "Table of contents" });
    for (const entry of TOC) {
      expect(
        within(popover).getByRole("button", { name: entry.label }),
      ).toBeTruthy();
    }
    expect(
      within(popover).getByRole("button", { name: "Chapter 4" }),
    ).toHaveAttribute("aria-current", "true");

    await user.click(
      within(popover).getByRole("button", { name: "Chapter 1" }),
    );
    expect(props.onNavigate).toHaveBeenCalledWith("ch1.html");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Escape closes the popover first, then the deck", async () => {
    const user = userEvent.setup();
    const props = renderDock();
    await user.click(
      within(deck()).getByRole("button", { name: "Table of contents" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Table of contents" }),
    ).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Table of contents" }),
    ).toBeNull();
    expect(props.onOpenChange).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says so when the book has no chapter list", async () => {
    const user = userEvent.setup();
    renderDock({ toc: [] });
    await user.click(
      within(deck()).getByRole("button", { name: "Table of contents" }),
    );
    expect(screen.getByText(/no chapter list/i)).toBeTruthy();
  });
});

// A small stateful host so `open` actually changes when the dock calls back.
function StatefulDock(over: Partial<ReaderDockProps> = {}) {
  const [open, setOpen] = useState(false);
  return <ReaderDock {...baseProps({ ...over, open, onOpenChange: setOpen })} />;
}

describe("ReaderDock — focus", () => {
  it("moves focus into the deck on open and back to the pill on close", async () => {
    const user = userEvent.setup();
    render(<StatefulDock />);

    const pill = screen.getByRole("button", { name: /open reading controls/i });
    await user.click(pill);

    const d = screen.getByRole("region", { name: "Reading controls" });
    expect(d).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("button", { name: /open reading controls/i }),
    ).toHaveFocus();
  });
});
