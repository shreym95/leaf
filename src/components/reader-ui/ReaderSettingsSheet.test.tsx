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
    <ReaderSettingsSheet open onOpenChange={() => {}} onSetTheme={() => {}} />,
  );
}

describe("ReaderSettingsSheet — text size", () => {
  it("+ raises the stored font size and the shown percentage", async () => {
    const user = userEvent.setup();
    open();

    expect(useReaderSettings.getState().fontSize).toBe(1.06);
    expect(screen.getByText("100%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Larger text" }));

    expect(useReaderSettings.getState().fontSize).toBeGreaterThan(1.06);
    expect(screen.queryByText("100%")).toBeNull();
  });

  it("− lowers the stored font size", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Smaller text" }));

    expect(useReaderSettings.getState().fontSize).toBeLessThan(1.06);
  });

  it("moves by a visible step (≥6% of the base size)", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Larger text" }));
    const after = useReaderSettings.getState().fontSize;

    // A step must be big enough to actually see — the original 0.04rem step
    // was under a pixel and read as "the button does nothing".
    expect((after - 1.06) / 1.06).toBeGreaterThan(0.06);
  });

  it("clamps at the maximum and disables +", async () => {
    const user = userEvent.setup();
    useReaderSettings.setState({ fontSize: 1.7 });
    open();

    const plus = screen.getByRole("button", { name: "Larger text" });
    expect(plus).toBeDisabled();
    await user.click(plus);
    expect(useReaderSettings.getState().fontSize).toBe(1.7);
  });

  it("round-trips: + then − returns to the base size", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Larger text" }));
    await user.click(screen.getByRole("button", { name: "Smaller text" }));

    expect(useReaderSettings.getState().fontSize).toBe(1.06);
    expect(screen.getByText("100%")).toBeInTheDocument();
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
});
