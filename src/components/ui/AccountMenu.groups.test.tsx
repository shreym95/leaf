import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The Groups entry in the account menu (the phone-width path, since the inline
 * nav is hidden below `sm`) is gated by GROUPS_ENABLED (GROUPS_V1_BUILD L1).
 */

const PROD = {
  NEXT_PUBLIC_SUPABASE_URL: "https://demo-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
  LEAF_DEMO: "",
  NEXT_PUBLIC_LEAF_DEMO: "",
};

vi.mock("@/lib/offline/purge", () => ({
  purgeAllOfflineData: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function openMenu(flag: string) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...PROD, NEXT_PUBLIC_LEAF_GROUPS: flag })) {
    vi.stubEnv(k, v);
  }
  const { AccountMenu } = await import("./AccountMenu");
  const user = userEvent.setup();
  render(<AccountMenu name="Reader Person" />);
  await user.click(screen.getByRole("button", { name: /account menu/i }));
  await screen.findByRole("menuitem", { name: "Library" });
  return screen.getAllByRole("menuitem").map((el) => el.textContent);
}

describe("AccountMenu Groups entry", () => {
  it("sits between Library and Settings when the flag is on", async () => {
    const items = await openMenu("1");
    expect(items).toEqual(["Library", "Groups", "Settings", "Privacy", "Sign out"]);
    expect(screen.getByRole("menuitem", { name: "Groups" })).toHaveAttribute(
      "href",
      "/groups",
    );
  });

  it("is absent when the flag is off", async () => {
    const items = await openMenu("");
    expect(items).toEqual(["Library", "Settings", "Privacy", "Sign out"]);
  });
});
