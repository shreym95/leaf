import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/** The reading-groups copy covers marks and notes, and what leaving removes. */

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

async function renderPage() {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...PROD, NEXT_PUBLIC_LEAF_GROUPS: "1" })) {
    vi.stubEnv(k, v);
  }
  const { default: PrivacyPage } = await import("./page");
  render(<PrivacyPage />);
}

describe("privacy page, marks and notes in groups", () => {
  it("says members see marks and notes only once they have read that far", async () => {
    await renderPage();
    expect(
      screen.getByText(/They also see the marks and notes you leave in those books/),
    ).toHaveTextContent(/only once they have read that far/);
  });

  it("says leaving a group removes marks and notes as well as progress", async () => {
    await renderPage();
    expect(
      screen.getByText(/Leaving a group removes your progress, marks and notes from it/),
    ).toBeInTheDocument();
  });
});
