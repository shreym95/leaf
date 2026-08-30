import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "./ThemeProvider";
import { ThemeSync } from "./ThemeSync";
import { ThemeToggle } from "./ThemeToggle";
import {
  useReaderSettings,
  READER_SETTINGS_DEFAULTS,
} from "@/store/reader-settings";

const h = vi.hoisted(() => ({ upsert: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: true,
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({ upsert: h.upsert }),
  }),
}));

const DAY_SETTINGS = { ...READER_SETTINGS_DEFAULTS, theme: "day" as const };
const NIGHT_SETTINGS = { ...READER_SETTINGS_DEFAULTS, theme: "night" as const };

beforeEach(() => {
  vi.clearAllMocks();
  h.upsert.mockResolvedValue({ error: null });
  useReaderSettings.setState({ ...READER_SETTINGS_DEFAULTS });
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme is one setting, not two", () => {
  it("adopts the persisted theme, so the chrome matches the reader", async () => {
    render(
      <ThemeProvider>
        <ThemeSync userId="u1" settings={DAY_SETTINGS} />
      </ThemeProvider>,
    );

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("day"),
    );
  });

  it("toggling in the chrome persists, so opening a book cannot flip it back", async () => {
    // The reported bug: the library was in Day, the toggle wrote only
    // localStorage, and opening a book restored Night from `reader_settings`.
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeSync userId="u1" settings={NIGHT_SETTINGS} />
        <ThemeToggle />
      </ThemeProvider>,
    );

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("night"),
    );

    await user.click(screen.getByRole("button", { name: /switch to day/i }));

    // The store — which the reader reads on open — now says day.
    expect(useReaderSettings.getState().theme).toBe("day");
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("day"),
    );
    // …and it was written through to reader_settings, not just localStorage.
    await waitFor(() => expect(h.upsert).toHaveBeenCalled());
    expect(h.upsert.mock.calls[0][0]).toMatchObject({
      user_id: "u1",
      theme: "day",
    });
  });

  it("carries the reader's typography through a theme toggle", async () => {
    // The store persists all five values together, so a partial hydrate plus a
    // toggle would write defaults over real choices.
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeSync
          userId="u1"
          settings={{ ...NIGHT_SETTINGS, fontSize: 1.26, margins: "wide" }}
        />
        <ThemeToggle />
      </ThemeProvider>,
    );

    await waitFor(() => expect(useReaderSettings.getState().fontSize).toBe(1.26));
    await user.click(screen.getByRole("button", { name: /switch to day/i }));

    await waitFor(() => expect(h.upsert).toHaveBeenCalled());
    expect(h.upsert.mock.calls[0][0]).toMatchObject({
      theme: "day",
      font_size: 1.26,
      margins: "wide",
    });
  });
});
