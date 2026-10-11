import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The Groups nav link is gated by GROUPS_ENABLED (GROUPS_V1_BUILD L1): present
 * only with the flag on and a signed-in user; with the flag off the inline
 * links are exactly Library and Settings.
 */

const PROD = {
  NEXT_PUBLIC_SUPABASE_URL: "https://demo-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
  LEAF_DEMO: "",
  NEXT_PUBLIC_LEAF_DEMO: "",
};

const getUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getUser: () => getUser() }));
vi.mock("@/components/theme/ThemePicker", () => ({ ThemePicker: () => null }));
vi.mock("@/components/ui/AccountMenu", () => ({ AccountMenu: () => null }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  getUser.mockReset();
});

async function renderNav(flag: string, signedIn = true) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...PROD, NEXT_PUBLIC_LEAF_GROUPS: flag })) {
    vi.stubEnv(k, v);
  }
  getUser.mockResolvedValue(signedIn ? { email: "reader@example.com" } : null);
  const { NavBar } = await import("./NavBar");
  render(await NavBar());
  return screen.queryAllByRole("link").map((a) => a.textContent);
}

describe("NavBar Groups link", () => {
  it("sits between Library and Settings when the flag is on", async () => {
    const links = await renderNav("1");
    expect(links).toEqual(["Leaf", "Library", "Groups", "Settings"]);
    expect(screen.getByRole("link", { name: "Groups" })).toHaveAttribute(
      "href",
      "/groups",
    );
  });

  it("is absent when the flag is off", async () => {
    const links = await renderNav("");
    expect(links).toEqual(["Leaf", "Library", "Settings"]);
  });

  it("is absent when signed out, even with the flag on", async () => {
    const links = await renderNav("1", false);
    expect(links).toEqual(["Leaf"]);
  });
});
