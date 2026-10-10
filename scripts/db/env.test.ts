// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseConfig, loadEnvLocal, parseEnv, projectRefFromUrl } from "./lib/env.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("parseEnv", () => {
  it("handles comments, export, quotes and trailing comments", () => {
    expect(
      parseEnv(['# c', 'A=1', 'export B="two words"', "C='x'", "D=val # note", "", "bad line"].join("\n")),
    ).toEqual({ A: "1", B: "two words", C: "x", D: "val" });
  });
});

describe("loadEnvLocal", () => {
  it("loads from the given directory without overriding real env vars", () => {
    const dir = mkdtempSync(join(tmpdir(), "leaf-env-"));
    dirs.push(dir);
    writeFileSync(join(dir, ".env.local"), "FROM_FILE=file\nSHARED=file\n");
    const env: Record<string, string | undefined> = { SHARED: "real" };
    expect(loadEnvLocal(dir, env as NodeJS.ProcessEnv)).toMatch(/\.env\.local$/);
    expect(env).toEqual({ FROM_FILE: "file", SHARED: "real" });
  });

  it("is a no-op without a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "leaf-env-"));
    dirs.push(dir);
    expect(loadEnvLocal(dir, {} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("project ref and config", () => {
  it("parses the ref from the URL", () => {
    expect(projectRefFromUrl("https://abcdefgh.supabase.co")).toBe("abcdefgh");
    expect(() => projectRefFromUrl("not a url")).toThrow();
  });

  it("names the missing variables, never their values", () => {
    expect(() => getSupabaseConfig({} as NodeJS.ProcessEnv)).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/,
    );
    const cfg = getSupabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://ref1.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "k",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.projectRef).toBe("ref1");
  });
});
