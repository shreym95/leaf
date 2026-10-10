// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBackup, timestampName } from "./lib/backup-core.mjs";
import { INCOMPLETE_FILE, sha256, verifyBackup } from "./lib/manifest.mjs";
import { createFakeClient } from "./testing/fake-client";

const U = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

const tables = {
  profiles: [{ id: U, display_name: "A" }],
  reader_settings: [{ user_id: U, theme: "night" }],
  books: [{ id: B, user_id: U, title: "T", storage_path: `${U}/${B}.epub` }],
  reading_state: [{ book_id: B, user_id: U, percent: 0.5 }],
  highlights: [],
  bookmarks: [],
};
const objects = {
  [`${U}/${B}.epub`]: new Uint8Array([1, 2, 3]),
  [`${U}/${B}-cover.jpg`]: new Uint8Array([9, 9]),
};

let base: string;
let out: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "leaf-backup-"));
  out = join(base, "run");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("runBackup", () => {
  it("writes tables, objects and a verifiable manifest, and removes the marker", async () => {
    const { client } = createFakeClient({ tables, objects });
    const manifest = await runBackup({ client, outDir: out, projectRef: "ref1" });

    expect(manifest.projectRef).toBe("ref1");
    expect(manifest.tables.books.rows).toBe(1);
    expect(manifest.tables.highlights.rows).toBe(0);
    expect(manifest.storage.objectCount).toBe(2);
    expect(existsSync(join(out, INCOMPLETE_FILE))).toBe(false);

    const booksBytes = readFileSync(join(out, "tables/books.json"));
    expect(manifest.tables.books.sha256).toBe(sha256(booksBytes));
    expect([...readFileSync(join(out, `storage/epubs/${U}/${B}.epub`))]).toEqual([1, 2, 3]);
    expect(() => verifyBackup(out)).not.toThrow();
  });

  it("fails on a table error, leaves INCOMPLETE and no manifest", async () => {
    const { client } = createFakeClient({ tables, objects, failTables: ["books"] });
    await expect(runBackup({ client, outDir: out, projectRef: "ref1" })).rejects.toThrow(/table books/);
    expect(existsSync(join(out, INCOMPLETE_FILE))).toBe(true);
    expect(readFileSync(join(out, INCOMPLETE_FILE), "utf8")).toMatch(/FAILED/);
    expect(existsSync(join(out, "manifest.json"))).toBe(false);
    expect(() => verifyBackup(out)).toThrow(/INCOMPLETE/);
  });

  it("fails on an object download error", async () => {
    const { client } = createFakeClient({ tables, objects, failDownloads: [`${U}/${B}-cover.jpg`] });
    await expect(runBackup({ client, outDir: out, projectRef: "ref1" })).rejects.toThrow(/cover\.jpg/);
    expect(existsSync(join(out, INCOMPLETE_FILE))).toBe(true);
    expect(existsSync(join(out, "manifest.json"))).toBe(false);
  });

  it("refuses a non-empty output directory", async () => {
    const { client } = createFakeClient({ tables, objects });
    await runBackup({ client, outDir: out, projectRef: "ref1" });
    await expect(runBackup({ client, outDir: out, projectRef: "ref1" })).rejects.toThrow(/not empty/);
  });

  it("does not write anything to the live project", async () => {
    const { client, calls } = createFakeClient({ tables, objects });
    await runBackup({ client, outDir: out, projectRef: "ref1" });
    expect(calls.mutations).toBe(0);
  });
});

describe("timestampName", () => {
  it("is a UTC, path-safe timestamp", () => {
    expect(timestampName(new Date("2026-10-11T12:34:56.789Z"))).toBe("2026-10-11T12-34-56Z");
  });
});

describe("verifyBackup", () => {
  it("aborts on a checksum mismatch in a table file", async () => {
    const { client } = createFakeClient({ tables, objects });
    await runBackup({ client, outDir: out, projectRef: "ref1" });
    writeFileSync(join(out, "tables/books.json"), "[]\n");
    expect(() => verifyBackup(out)).toThrow(/checksum mismatch/);
  });

  it("aborts on a checksum mismatch in an object", async () => {
    const { client } = createFakeClient({ tables, objects });
    await runBackup({ client, outDir: out, projectRef: "ref1" });
    writeFileSync(join(out, `storage/epubs/${U}/${B}.epub`), "tampered");
    expect(() => verifyBackup(out)).toThrow(/checksum mismatch/);
  });

  it("aborts when a file is missing", async () => {
    const { client } = createFakeClient({ tables, objects });
    await runBackup({ client, outDir: out, projectRef: "ref1" });
    rmSync(join(out, "tables/profiles.json"));
    expect(() => verifyBackup(out)).toThrow(/cannot read/);
  });

  it("refuses a manifest that points outside the backup directory", async () => {
    const { client } = createFakeClient({ tables, objects });
    await runBackup({ client, outDir: out, projectRef: "ref1" });
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    manifest.tables.books.file = "../../etc/passwd";
    writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest));
    expect(() => verifyBackup(out)).toThrow(/Unsafe path|cannot read/);
  });
});
