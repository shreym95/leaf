import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/** Notes v1 copy: personal marks, highlights and notes are private; shared copies are limited. */

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

describe("privacy page, Notes", () => {
  it("says personal marks, highlights and notes are private to you, with the flag off", async () => {
    await renderPage("");
    expect(
      screen.getByText(/Your marks, highlights and notes are private to you/),
    ).toBeInTheDocument();
  });

  it("covers marks, highlights, notes and group copies in the deletion list", async () => {
    await renderPage("");
    expect(
      screen.getByText(/all of your marks, highlights and notes/),
    ).toHaveTextContent(/including any copies shared with a group/);
  });

  it("states the spoiler gate and the 300-character quote limit when the flag is on", async () => {
    await renderPage("1");
    expect(
      screen.getByText(/Only the items you choose to share reach the group/),
    ).toHaveTextContent(/only once they have read that far/);
    expect(
      screen.getByText(/up to 300 characters of its quoted text/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/including anything you shared there/),
    ).toBeInTheDocument();
  });

  it("omits the group quote limit when the flag is off", async () => {
    await renderPage("");
    expect(screen.queryByText(/300 characters/)).toBeNull();
  });

  it("no longer mentions bookmarks", async () => {
    await renderPage("1");
    expect(document.body.textContent ?? "").not.toMatch(/bookmark/i);
  });
});
