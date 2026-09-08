import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The safety-critical assertion: demo mode (in-memory fixtures, no auth) can
 * NEVER activate in production. Production always has the two Supabase env vars
 * and never sets LEAF_DEMO — so with that combination `IS_DEMO` must be false.
 */

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "LEAF_DEMO",
  "NEXT_PUBLIC_LEAF_DEMO",
] as const;

const snapshot = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
  vi.resetModules();
});

/** Load a fresh copy of the module with the given env applied. */
async function loadIsDemo(
  env: Partial<Record<(typeof KEYS)[number], string | undefined>>,
): Promise<boolean> {
  vi.resetModules();
  for (const k of KEYS) {
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return (await import("./flag")).IS_DEMO;
}

const SUPABASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://demo-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
};

describe("IS_DEMO", () => {
  it("is OFF in production: both Supabase vars present, no LEAF_DEMO", async () => {
    expect(await loadIsDemo({ ...SUPABASE_ENV })).toBe(false);
  });

  it("stays OFF when LEAF_DEMO is set but not exactly \"1\"", async () => {
    expect(await loadIsDemo({ ...SUPABASE_ENV, LEAF_DEMO: "0" })).toBe(false);
    expect(await loadIsDemo({ ...SUPABASE_ENV, LEAF_DEMO: "true" })).toBe(false);
    expect(await loadIsDemo({ ...SUPABASE_ENV, NEXT_PUBLIC_LEAF_DEMO: "" })).toBe(
      false,
    );
  });

  it("is ON under the explicit flag, even with Supabase configured", async () => {
    expect(await loadIsDemo({ ...SUPABASE_ENV, LEAF_DEMO: "1" })).toBe(true);
    expect(
      await loadIsDemo({ ...SUPABASE_ENV, NEXT_PUBLIC_LEAF_DEMO: "1" }),
    ).toBe(true);
  });

  it("falls back to ON when Supabase is not configured (bare `npm run dev` after a fresh clone)", async () => {
    expect(
      await loadIsDemo({
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
        LEAF_DEMO: undefined,
        NEXT_PUBLIC_LEAF_DEMO: undefined,
      }),
    ).toBe(true);
  });

  it("treats a half-configured env (one var blank) as not-production", async () => {
    expect(
      await loadIsDemo({
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_ENV.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      }),
    ).toBe(true);
  });
});
