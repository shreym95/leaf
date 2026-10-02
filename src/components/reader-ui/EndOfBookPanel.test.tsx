import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EndOfBookPanel } from "./EndOfBookPanel";

function renderPanel(
  props: Partial<React.ComponentProps<typeof EndOfBookPanel>> = {},
) {
  const handlers = {
    onClose: vi.fn(),
    onMarkFinished: vi.fn(),
    onMarkUnread: vi.fn(),
  };
  const utils = render(
    <EndOfBookPanel
      title="Frankenstein"
      author="Mary Shelley"
      finished
      {...handlers}
      {...props}
    />,
  );
  return { ...utils, ...handlers };
}

describe("EndOfBookPanel", () => {
  it("is a labelled region with the title as its heading, which takes focus on open", () => {
    renderPanel();
    expect(screen.getByRole("region", { name: "End of book" })).toBeTruthy();
    const heading = screen.getByRole("heading", { name: "Frankenstein" });
    expect(document.activeElement).toBe(heading);
  });

  it("finished: eyebrow, author, date, and Mark as unread", () => {
    renderPanel({ finishedOn: new Date(2026, 9, 2) });
    expect(screen.getByText("Finished")).toBeTruthy();
    expect(screen.getByText("Mary Shelley")).toBeTruthy();
    const time = document.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-10-02");
    expect(screen.getByRole("button", { name: "Mark as unread" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark as finished" })).toBeNull();
  });

  it("finished without a known date omits the date", () => {
    renderPanel({ finishedOn: null });
    expect(document.querySelector("time")).toBeNull();
  });

  it("not finished: 'The end', no date, and Mark as finished", () => {
    renderPanel({ finished: false, finishedOn: new Date(2026, 9, 2) });
    expect(screen.getByText("The end")).toBeTruthy();
    expect(screen.queryByText("Finished")).toBeNull();
    expect(document.querySelector("time")).toBeNull();
    expect(screen.getByRole("button", { name: "Mark as finished" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark as unread" })).toBeNull();
  });

  it("offers a real link to the library and a close button", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();
    expect(
      screen.getByRole("link", { name: "Back to library" }).getAttribute("href"),
    ).toBe("/library");
    await user.click(screen.getByRole("button", { name: "Back to the last page" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("routes the third action by state and announces it politely", async () => {
    const user = userEvent.setup();
    const a = renderPanel({ finished: true });
    await user.click(screen.getByRole("button", { name: "Mark as unread" }));
    expect(a.onMarkUnread).toHaveBeenCalledTimes(1);
    expect(a.onMarkFinished).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Marked as unread.");
    a.unmount();

    const b = renderPanel({ finished: false });
    await user.click(screen.getByRole("button", { name: "Mark as finished" }));
    expect(b.onMarkFinished).toHaveBeenCalledTimes(1);
    expect(b.onMarkUnread).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Marked as finished.");
  });

  it("keeps focus on the same control when the state flips", async () => {
    const user = userEvent.setup();
    const { rerender, onClose, onMarkFinished, onMarkUnread } = renderPanel();
    const btn = screen.getByRole("button", { name: "Mark as unread" });
    await user.click(btn);
    rerender(
      <EndOfBookPanel
        title="Frankenstein"
        author="Mary Shelley"
        finished={false}
        onClose={onClose}
        onMarkFinished={onMarkFinished}
        onMarkUnread={onMarkUnread}
      />,
    );
    const after = screen.getByRole("button", { name: "Mark as finished" });
    expect(after).toBe(btn);
    expect(document.activeElement).toBe(after);
  });
});
