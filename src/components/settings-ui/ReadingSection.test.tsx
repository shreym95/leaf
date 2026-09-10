import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReadingSection } from "./ReadingSection";
import {
  useReaderSettings,
  READER_SETTINGS_DEFAULTS,
  type ReaderSettingsValues,
} from "@/store/reader-settings";

// The store persists through the browser Supabase client; not under test here.
vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: false,
  createClient: () => {
    throw new Error("not configured");
  },
}));

beforeEach(() => {
  // Reset both the values AND the hydration bookkeeping (`reset()`), so each
  // test's `hydrate` call actually seeds rather than being a same-user no-op.
  useReaderSettings.getState().reset();
});

function open(initialSettings: ReaderSettingsValues, userId = "user-1") {
  render(<ReadingSection userId={userId} initialSettings={initialSettings} />);
}

describe("ReadingSection — seeding", () => {
  it("hydrates the store from the passed-in server row rather than showing defaults", () => {
    open({
      fontFamily: "sans",
      fontSize: 1.06,
      lineSpacing: 1.8,
      margins: "wide",
      theme: "day",
    });

    expect(screen.getByRole("radio", { name: /^Sans$/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /^Spacious$/ })).toHaveAttribute("aria-checked", "true");
  });
});

describe("ReadingSection — Typeface", () => {
  it("offers Serif / Sans / Legible, the last labelled as an accessibility option", () => {
    open(READER_SETTINGS_DEFAULTS);
    const group = screen.getByRole("radiogroup", { name: "Typeface" });
    const radios = Array.from(group.querySelectorAll("[role=radio]"));
    expect(radios.map((n) => n.getAttribute("aria-label"))).toEqual(["Serif", "Sans", "Legible"]);

    // The accessible NAME stays a clean "Legible" (no run-on with the
    // caption); the accessibility framing is exposed as a description instead,
    // still discoverable from the rendered text.
    const legible = screen.getByRole("radio", { name: "Legible" });
    expect(legible.textContent).toMatch(/low-vision/i);
    expect(legible.textContent).toMatch(/dyslexia/i);
  });

  it("each option is selectable and persisted to the store", async () => {
    const user = userEvent.setup();
    open(READER_SETTINGS_DEFAULTS);

    await user.click(screen.getByRole("radio", { name: /^Sans$/ }));
    expect(useReaderSettings.getState().fontFamily).toBe("sans");

    await user.click(screen.getByRole("radio", { name: /^Legible/ }));
    expect(useReaderSettings.getState().fontFamily).toBe("legible");

    await user.click(screen.getByRole("radio", { name: /^Serif$/ }));
    expect(useReaderSettings.getState().fontFamily).toBe("serif");
  });
});

describe("ReadingSection — Density", () => {
  it("offers Compact / Standard / Spacious", () => {
    open(READER_SETTINGS_DEFAULTS);
    const group = screen.getByRole("radiogroup", { name: "Density" });
    const radios = Array.from(group.querySelectorAll("[role=radio]"));
    expect(radios.map((n) => n.getAttribute("aria-label"))).toEqual(["Compact", "Standard", "Spacious"]);
  });

  it("each preset writes both lineSpacing and margins together", async () => {
    const user = userEvent.setup();
    open(READER_SETTINGS_DEFAULTS);

    await user.click(screen.getByRole("radio", { name: /^Compact/ }));
    expect(useReaderSettings.getState().lineSpacing).toBe(1.45);
    expect(useReaderSettings.getState().margins).toBe("narrow");

    await user.click(screen.getByRole("radio", { name: /^Spacious/ }));
    expect(useReaderSettings.getState().lineSpacing).toBe(1.8);
    expect(useReaderSettings.getState().margins).toBe("wide");

    await user.click(screen.getByRole("radio", { name: /^Standard/ }));
    expect(useReaderSettings.getState().lineSpacing).toBe(1.62);
    expect(useReaderSettings.getState().margins).toBe("normal");
  });

  it("derives the checked preset from the stored (lineSpacing, margins) pair", () => {
    open({
      fontFamily: "serif",
      fontSize: 1.06,
      lineSpacing: 1.45,
      margins: "narrow",
      theme: "night",
    });
    expect(screen.getByRole("radio", { name: /^Compact/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /^Standard/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: /^Spacious/ })).toHaveAttribute("aria-checked", "false");
  });

  it("selects none of the three when the stored pair matches no preset (a legacy value)", async () => {
    // The retired continuous sheet could persist e.g. 1.85 / "wide", which is
    // not any of the three current preset rows.
    open({
      fontFamily: "serif",
      fontSize: 1.06,
      lineSpacing: 1.85,
      margins: "wide",
      theme: "night",
    });

    const group = screen.getByRole("radiogroup", { name: "Density" });
    const radios = Array.from(group.querySelectorAll("[role=radio]"));
    expect(radios.every((n) => n.getAttribute("aria-checked") === "false")).toBe(true);

    // The first click on any preset adopts it outright.
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: /^Standard/ }));
    expect(useReaderSettings.getState().lineSpacing).toBe(1.62);
    expect(useReaderSettings.getState().margins).toBe("normal");
    expect(screen.getByRole("radio", { name: /^Standard/ })).toHaveAttribute("aria-checked", "true");
  });
});

describe("ReadingSection — Preview", () => {
  it("renders the sample paragraph", () => {
    open(READER_SETTINGS_DEFAULTS);
    expect(screen.getByText(/truth universally acknowledged/)).toBeInTheDocument();
  });
});
