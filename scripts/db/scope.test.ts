// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBackup } from "./lib/backup-core.mjs";
import { EXTRA_TABLES } from "./lib/extra-tables.mjs";
import { verifyBackup } from "./lib/manifest.mjs";
import { ALL_TABLE_NAMES, parseTableList, selectTables } from "./lib/select-tables.mjs";
import { createFakeClient } from "./testing/fake-client";

const U = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

const tables = {
  profiles: [{ id: U, display_name: "A" }],
  reader_settings: [{ user_id: U, theme: "night" }],
  books: [{ id: B, user_id: U, title: "T", storage_path: `${U}/${B}.epub` }],
  reading_state: [{ book_id: B, user_id: U, percent: 0.5 }],
  highlights: [{ id: "h1", user_id: U, book_id: B, text: "x" }],
  bookmarks: [{ id: "m1", user_id: U, book_id: B }],
  annotations: [{ id: "a1", user_id: U, book_id: B, kind: "note" }],
  read_notes: [{ id: "n1", user_id: U, read_id: "r1", body: "z" }],
};
const objects = {
  [`${U}/${B}.epub`]: new Uint8Array([1, 2, 3]),
};

const CORE = ["profiles", "reader_settings", "books", "reading_state", "highlights", "bookmarks"];

let base: string;
let out: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "leaf-scope-"));
  out = join(base, "run");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("table selection", () => {
  it("parses the 0012 pre-release list, in restore order", () => {
    expect(parseTableList("bookmarks,highlights,read_notes,annotations")).toEqual([
      "highlights",
      "bookmarks",
      "annotations",
      "read_notes",
    ]);
  });

  it("trims spaces and drops duplicates", () => {
    expect(parseTableList(" books , annotations,books ")).toEqual(["books", "annotations"]);
  });

  it("refuses an unknown name and lists the valid ones", () => {
    expect(() => parseTableList("bookmarks,nope")).toThrow(/Unknown table\(s\): "nope"\. Valid tables: /);
    expect(() => parseTableList("bookmarks,nope")).toThrow(
      /profiles, reader_settings, books, reading_state, highlights, bookmarks, annotations, read_notes\./,
    );
  });

  it("refuses an empty list or an empty name", () => {
    expect(() => parseTableList("")).toThrow(/needs a comma-separated list/);
    expect(() => parseTableList("books,,highlights")).toThrow(/empty name/);
    expect(() => selectTables([])).toThrow(/No tables named/);
  });

  it("returns definitions with the keys the restore relies on", () => {
    const byName = Object.fromEntries(EXTRA_TABLES.map((t) => [t.name, t]));
    expect(byName.annotations).toEqual({ name: "annotations", pk: ["id"], userColumn: "user_id", bookColumn: "book_id" });
    expect(byName.read_notes).toEqual({ name: "read_notes", pk: ["id"], userColumn: "user_id" });
    expect(ALL_TABLE_NAMES).toEqual([...CORE, "annotations", "read_notes"]);
  });
});

describe("scoped runBackup", () => {
  it("writes only the named tables, parents first, and nothing else", async () => {
    const { client, calls } = createFakeClient({ tables, objects });
    const manifest = await runBackup({
      client,
      outDir: out,
      projectRef: "ref1",
      tableNames: ["read_notes", "annotations", "bookmarks", "highlights"],
    });

    expect(Object.keys(manifest.tables)).toEqual(["highlights", "bookmarks", "annotations", "read_notes"]);
    expect(calls.ranges.map((r) => r.table)).toEqual(["highlights", "bookmarks", "annotations", "read_notes"]);
    expect(existsSync(join(out, "tables/profiles.json"))).toBe(false);
    expect(existsSync(join(out, "tables/books.json"))).toBe(false);
    expect(manifest.tables.annotations.rows).toBe(1);
  });

  it("skips the bucket: no listing, no downloads, no storage files", async () => {
    const { client, calls } = createFakeClient({ tables, objects });
    const manifest = await runBackup({ client, outDir: out, projectRef: "ref1", tableNames: ["annotations"] });

    expect(calls.listCalls).toHaveLength(0);
    expect(manifest.storage.objectCount).toBe(0);
    expect(manifest.storage.objects).toEqual([]);
    expect(existsSync(join(out, "storage"))).toBe(false);
  });

  it("records the scope in the manifest and still verifies", async () => {
    const { client } = createFakeClient({ tables, objects });
    await runBackup({ client, outDir: out, projectRef: "ref1", tableNames: ["bookmarks", "highlights", "read_notes", "annotations"] });

    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    expect(manifest.scope).toEqual({
      scoped: true,
      tables: ["highlights", "bookmarks", "annotations", "read_notes"],
      storage: false,
    });
    expect(manifest.projectRef).toBe("ref1");
    expect(manifest.version).toBe(1);
    expect(() => verifyBackup(out)).not.toThrow();
  });

  it("records a full backup as unscoped, with storage", async () => {
    const { client, calls } = createFakeClient({ tables, objects });
    const manifest = await runBackup({ client, outDir: out, projectRef: "ref1" });

    expect(manifest.scope).toEqual({ scoped: false, tables: CORE, storage: true });
    expect(manifest.storage.objectCount).toBe(1);
    expect(calls.listCalls.length).toBeGreaterThan(0);
  });

  it("refuses an unknown table before creating the output directory", async () => {
    const { client } = createFakeClient({ tables, objects });
    await expect(runBackup({ client, outDir: out, projectRef: "ref1", tableNames: ["nope"] })).rejects.toThrow(
      /Unknown table\(s\): "nope"/,
    );
    expect(existsSync(out)).toBe(false);
  });

  it("does not write anything to the live project", async () => {
    const { client, calls } = createFakeClient({ tables, objects });
    await runBackup({ client, outDir: out, projectRef: "ref1", tableNames: ["annotations", "read_notes"] });
    expect(calls.mutations).toBe(0);
  });
});
