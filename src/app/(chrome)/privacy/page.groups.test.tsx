import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/** The "Reading groups" section renders only when GROUPS_ENABLED (L1). */

const PROD = {
  NEXT_PUBLIC_SUPABASE_URL: "https://demo-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
  LEAF_DEMO: "",
  NEXT_PUBLIC_LEAF_DEMO: "",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function renderPage(flag: string) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...PROD, NEXT_PUBLIC_LEAF_GROUPS: flag })) {
    vi.stubEnv(k, v);
  }
  const { default: PrivacyPage } = await import("./page");
  render(<PrivacyPage />);
}

describe("privacy page, reading groups section", () => {
  it("states what members see and that files are never shared when the flag is on", async () => {
    await renderPage("1");
    expect(
      screen.getByRole("heading", { name: "Reading groups" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Members of a group you join can see your display name/),
    ).toHaveTextContent(/progress and milestones/);
    expect(screen.getByText(/never shared/)).toBeInTheDocument();
    expect(screen.getByText(/Leaving a group removes/)).toBeInTheDocument();
  });

  it("is absent when the flag is off", async () => {
    await renderPage("");
    expect(screen.queryByRole("heading", { name: "Reading groups" })).toBeNull();
    expect(screen.queryByText(/never shared/)).toBeNull();
  });
});
