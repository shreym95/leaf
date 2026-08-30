import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "./ThemeProvider";
import { ThemePicker } from "./ThemePicker";
import { THEMES, THEME_IDS } from "@/design/themes";
import { useReaderSettings } from "@/store/reader-settings";

const h = vi.hoisted(() => ({ upsert: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: true,
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({ upsert: h.upsert }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  h.upsert.mockResolvedValue({ error: null });
  useReaderSettings.getState().reset();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

function renderPicker() {
  return render(
    <ThemeProvider>
      <ThemePicker />
    </ThemeProvider>,
  );
}

describe("ThemePicker", () => {
  it("renders exactly one segment per registered theme, labelled from the registry", () => {
    renderPicker();
    const group = screen.getByRole("radiogroup", { name: /theme/i });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(THEME_IDS.length);
    for (const id of THEME_IDS) {
      expect(
        within(group).getByRole("radio", { name: THEMES[id].label }),
      ).toBeInTheDocument();
    }
  });

  it("marks the current theme and only the current theme", () => {
    document.documentElement.dataset.theme = "day";
    renderPicker();
    const checked = screen
      .getAllByRole("radio")
      .filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAccessibleName(THEMES.day.label);
  });

  it("clicking a segment writes through the reader-settings store, then the document", async () => {
    const user = userEvent.setup();
    document.documentElement.dataset.theme = "night";
    // Seed a signed-in user so the store persists (the founder's bug: writing
    // only the document let the DB value win on the next load).
    useReaderSettings.getState().hydrate({ theme: "night" }, "u1");
    renderPicker();

    await user.click(screen.getByRole("radio", { name: THEMES.day.label }));

    expect(useReaderSettings.getState().theme).toBe("day");
    expect(document.documentElement.dataset.theme).toBe("day");
    await waitFor(() => expect(h.upsert).toHaveBeenCalled());
    expect(h.upsert.mock.calls[0][0]).toMatchObject({
      user_id: "u1",
      theme: "day",
    });
  });

  it("still works signed out as a local toggle (no auth check)", async () => {
    const user = userEvent.setup();
    document.documentElement.dataset.theme = "night";
    renderPicker();

    await user.click(screen.getByRole("radio", { name: THEMES.day.label }));

    expect(document.documentElement.dataset.theme).toBe("day");
    expect(useReaderSettings.getState().theme).toBe("day");
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("is a single Tab stop with roving tabindex on the checked segment", () => {
    document.documentElement.dataset.theme = THEME_IDS[0];
    renderPicker();
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).toHaveAttribute("tabindex", "0");
    for (const r of radios.slice(1)) {
      expect(r).toHaveAttribute("tabindex", "-1");
    }
  });

  it("Arrow keys move between segments and select as they go", async () => {
    const user = userEvent.setup();
    document.documentElement.dataset.theme = THEME_IDS[0];
    renderPicker();

    const radios = screen.getAllByRole("radio");
    radios[0].focus();

    await user.keyboard("{ArrowRight}");
    expect(document.documentElement.dataset.theme).toBe(THEME_IDS[1]);
    expect(radios[1]).toHaveFocus();
    expect(radios[1]).toHaveAttribute("aria-checked", "true");

    // Wraps from the last segment back to the first.
    await user.keyboard("{ArrowLeft}");
    expect(document.documentElement.dataset.theme).toBe(THEME_IDS[0]);

    await user.keyboard("{End}");
    expect(document.documentElement.dataset.theme).toBe(
      THEME_IDS[THEME_IDS.length - 1],
    );
    await user.keyboard("{Home}");
    expect(document.documentElement.dataset.theme).toBe(THEME_IDS[0]);
  });
});
