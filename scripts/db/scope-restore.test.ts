// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBackup } from "./lib/backup-core.mjs";
import { planRestore, runRestore } from "./lib/restore-core.mjs";
import { sha256 } from "./lib/manifest.mjs";
import { createFakeClient } from "./testing/fake-client";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "33333333-3333-3333-3333-333333333333"; // deleted from auth since the backup
const B1 = "22222222-2222-2222-2222-222222222222";
const B2 = "44444444-4444-4444-4444-444444444444"; // not in the live books table

// What the scoped backup was taken from.
const source = {
  books: [{ id: B1, user_id: U1, title: "one" }],
  annotations: [
    { id: "a1", user_id: U1, book_id: B1, kind: "note" },
    { id: "a2", user_id: U1, book_id: B2, kind: "note" },
  ],
  read_notes: [
    { id: "n1", user_id: U1, read_id: "r1", body: "kept" },
    { id: "n2", user_id: U2, read_id: "r1", body: "user gone" },
  ],
};

let base: string;
let dir: string;
beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "leaf-scope-restore-"));
  dir = join(base, "backup");
  await runBackup({
    client: createFakeClient({ tables: source, objects: { [`${U1}/${B1}.epub`]: new Uint8Array([1]) } }).client,
    outDir: dir,
    projectRef: "ref1",
    tableNames: ["annotations", "read_notes"],
  });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function liveClient() {
  // Live project: U1 and book B1 exist, U2 is gone, B2 is not there.
  return createFakeClient({
    tables: {
      books: [{ id: B1, user_id: U1, title: "live" }],
      annotations: [],
      read_notes: [],
    },
    objects: {},
    authUserIds: [U1],
  });
}

describe("scoped restore", () => {
  it("dry run plans only the scoped tables and never reads the bucket", async () => {
    const live = liveClient();
    const lines: string[] = [];
    const plan = await runRestore({
      client: live.client,
      dir,
      apply: false,
      envProjectRef: "ref1",
      log: (l: string) => lines.push(l),
    });

    expect(plan.tables.map((t) => t.name)).toEqual(["annotations", "read_notes"]);
    expect(plan.storageInScope).toBe(false);
    expect(plan.missingObjects).toEqual([]);
    expect(live.calls.listCalls).toHaveLength(0);
    expect(live.calls.mutations).toBe(0);
    expect(lines.join("\n")).toMatch(/DRY RUN/);
    expect(lines.join("\n")).toMatch(/storage epubs: not in backup scope/);
  });

  it("checks annotation books against the live books table when books is out of scope", async () => {
    const plan = await planRestore({
      client: liveClient().client,
      dir,
      manifest: JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")),
    });
    const byName = Object.fromEntries(plan.tables.map((t) => [t.name, t]));
    expect(byName.annotations).toMatchObject({ inserts: 1, updates: 0 });
    expect(byName.annotations.skipped).toEqual({ missingUser: 0, missingBook: 1 });
    expect(byName.read_notes).toMatchObject({ inserts: 1 });
    expect(byName.read_notes.skipped).toEqual({ missingUser: 1, missingBook: 0 });
  });

  it("apply writes only the scoped tables, in order, and touches no other table", async () => {
    const live = liveClient();
    await runRestore({ client: live.client, dir, apply: true, envProjectRef: "ref1" });

    expect(live.calls.upserts.map((u) => u.table)).toEqual(["annotations", "read_notes"]);
    expect(live.calls.upserts.find((u) => u.table === "annotations")!.onConflict).toBe("id");
    expect(live.calls.uploads).toEqual([]);
    expect(live.tables.get("annotations")).toEqual([{ id: "a1", user_id: U1, book_id: B1, kind: "note" }]);
    expect(live.tables.get("books")).toEqual([{ id: B1, user_id: U1, title: "live" }]);
  });

  it("refuses a scoped manifest that names a table the scripts do not know", async () => {
    const bytes = Buffer.from("[]\n", "utf8");
    writeFileSync(join(dir, "tables/bogus.json"), bytes);
    const manifestPath = join(dir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.tables.bogus = { file: "tables/bogus.json", rows: 0, sha256: sha256(bytes) };
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const live = liveClient();
    await expect(runRestore({ client: live.client, dir, apply: true, envProjectRef: "ref1" })).rejects.toThrow(
      /unknown table "bogus"/,
    );
    expect(live.calls.mutations).toBe(0);
  });
});
