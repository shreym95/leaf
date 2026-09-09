import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReaderSettingsSheet } from "./ReaderSettingsSheet";
import {
  useReaderSettings,
  READER_SETTINGS_DEFAULTS,
} from "@/store/reader-settings";

// The store persists through the browser Supabase client; not under test here.
vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: false,
  createClient: () => {
    throw new Error("not configured");
  },
}));

beforeEach(() => {
  useReaderSettings.setState({ ...READER_SETTINGS_DEFAULTS });
});

function open() {
  render(
    <ReaderSettingsSheet
      open
      onOpenChange={() => {}}
      onSetTheme={() => {}}
      onOpenNotes={() => {}}
    />,
  );
}

describe("ReaderSettingsSheet — text size", () => {
  it("offers exactly S / M / L", () => {
    open();
    const group = screen.getByRole("radiogroup", { name: "Text size" });
    expect(
      Array.from(group.querySelectorAll("[role=radio]")).map((n) =>
        n.textContent,
      ),
    ).toEqual(["S", "M", "L"]);
  });

  it("each choice writes a distinct, clearly different size", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("radio", { name: "S" }));
    const small = useReaderSettings.getState().fontSize;

    await user.click(screen.getByRole("radio", { name: "L" }));
    const large = useReaderSettings.getState().fontSize;

    await user.click(screen.getByRole("radio", { name: "M" }));
    const medium = useReaderSettings.getState().fontSize;

    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
    // Neighbours must differ enough to be obvious on screen (>15%).
    expect(medium / small).toBeGreaterThan(1.15);
    expect(large / medium).toBeGreaterThan(1.15);
  });

  it("marks the active size, snapping a legacy persisted value", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("radio", { name: "L" }));
    expect(screen.getByRole("radio", { name: "L" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // A value stored by the old continuous stepper still highlights a chip.
    useReaderSettings.setState({ fontSize: 1.11 });
    expect(
      screen
        .getAllByRole("radio")
        .filter((n) => n.getAttribute("aria-checked") === "true"),
    ).toHaveLength(5); // one per group: size, font, spacing, margins, theme
  });

  it("other controls still write through", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("radio", { name: "Hyperlegible" }));
    expect(useReaderSettings.getState().fontFamily).toBe("legible");

    await user.click(screen.getByRole("radio", { name: "Roomy" }));
    expect(useReaderSettings.getState().lineSpacing).toBe(1.85);

    await user.click(screen.getByRole("radio", { name: "Wide" }));
    expect(useReaderSettings.getState().margins).toBe("wide");
  });

  it("has a Notes & bookmarks row that calls onOpenNotes", async () => {
    // The top bar's Notes button is gone since the reader dock — this row is
    // the only way into the panel.
    const user = userEvent.setup();
    const onOpenNotes = vi.fn();
    render(
      <ReaderSettingsSheet
        open
        onOpenChange={() => {}}
        onSetTheme={() => {}}
        onOpenNotes={onOpenNotes}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenNotes).toHaveBeenCalledTimes(1);
  });
});
