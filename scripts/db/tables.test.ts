// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TABLE_NAMES, TABLES } from "./lib/tables.mjs";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");

describe("FK order", () => {
  it("is parents first", () => {
    expect(TABLE_NAMES).toEqual([
      "profiles",
      "reader_settings",
      "books",
      "reading_state",
      "highlights",
      "bookmarks",
    ]);
  });

  it("puts every table after the public tables it references in the migrations", () => {
    const sql = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
      .join("\n");
    const found = new Map<string, string[]>();
    for (const m of sql.matchAll(/create table public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      found.set(m[1], [...m[2].matchAll(/references public\.(\w+)/g)].map((r) => r[1]));
    }
    for (const name of TABLE_NAMES) {
      expect(found.has(name), `${name} not found in migrations`).toBe(true);
      for (const parent of found.get(name)!) {
        if (!TABLE_NAMES.includes(parent)) continue;
        expect(TABLE_NAMES.indexOf(parent), `${parent} must precede ${name}`).toBeLessThan(TABLE_NAMES.indexOf(name));
      }
    }
  });

  it("declares a primary key for every table, and its parents' columns", () => {
    for (const t of TABLES) expect(t.pk.length).toBeGreaterThan(0);
    expect(TABLES.find((t) => t.name === "reading_state")!.pk).toEqual(["book_id", "user_id"]);
  });
});
