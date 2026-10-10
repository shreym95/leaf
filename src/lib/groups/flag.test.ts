import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * GROUPS_ENABLED is the single switch for groups (GROUPS_V1_BUILD L1, L5):
 * on only for the exact string "1", and never in demo mode.
 */

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

async function load(env: Record<string, string>): Promise<boolean> {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...PROD, ...env })) vi.stubEnv(k, v);
  return (await import("./flag")).GROUPS_ENABLED;
}

describe("GROUPS_ENABLED", () => {
  it("is off by default", async () => {
    expect(await load({ NEXT_PUBLIC_LEAF_GROUPS: "" })).toBe(false);
  });

  it("is on with NEXT_PUBLIC_LEAF_GROUPS=1 outside demo mode", async () => {
    expect(await load({ NEXT_PUBLIC_LEAF_GROUPS: "1" })).toBe(true);
  });

  it("is off in demo mode even with the flag set (explicit demo)", async () => {
    expect(
      await load({ NEXT_PUBLIC_LEAF_GROUPS: "1", NEXT_PUBLIC_LEAF_DEMO: "1" }),
    ).toBe(false);
    expect(await load({ NEXT_PUBLIC_LEAF_GROUPS: "1", LEAF_DEMO: "1" })).toBe(false);
  });

  it("is off in demo mode when Supabase is not configured", async () => {
    expect(
      await load({
        NEXT_PUBLIC_LEAF_GROUPS: "1",
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      }),
    ).toBe(false);
  });

  it("is off for any value other than exactly \"1\"", async () => {
    for (const v of ["true", "0", "", "yes", " 1", "1 "]) {
      expect(await load({ NEXT_PUBLIC_LEAF_GROUPS: v })).toBe(false);
    }
  });
});
