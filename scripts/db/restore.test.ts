// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBackup } from "./lib/backup-core.mjs";
import { INCOMPLETE_FILE } from "./lib/manifest.mjs";
import { resolveMode, runRestore } from "./lib/restore-core.mjs";
import { createFakeClient } from "./testing/fake-client";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "33333333-3333-3333-3333-333333333333"; // deleted from auth since the backup
const B1 = "22222222-2222-2222-2222-222222222222";
const B2 = "44444444-4444-4444-4444-444444444444";

const tables = {
  profiles: [{ id: U1 }, { id: U2 }],
  reader_settings: [{ user_id: U1 }, { user_id: U2 }],
  books: [
    { id: B1, user_id: U1, title: "one" },
    { id: B2, user_id: U2, title: "two" },
  ],
  reading_state: [
    { book_id: B1, user_id: U1, percent: 0.4 },
    { book_id: B2, user_id: U2, percent: 0.9 },
  ],
  highlights: [{ id: "h1", book_id: B2, user_id: U1, text: "x" }], // user alive, book skipped
  bookmarks: [],
};
const objects = {
  [`${U1}/${B1}.epub`]: new Uint8Array([1]),
  [`${U1}/${B1}-cover.jpg`]: new Uint8Array([2]),
};

let base: string;
let dir: string;
beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "leaf-restore-"));
  dir = join(base, "backup");
  await runBackup({ client: createFakeClient({ tables, objects }).client, outDir: dir, projectRef: "ref1" });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("resolveMode", () => {
  it("is a dry run without flags", () => {
    expect(resolveMode({ envProjectRef: "ref1" })).toEqual({ apply: false });
  });

  it("applies only with --apply and a matching --project-ref", () => {
    expect(resolveMode({ apply: true, projectRef: "ref1", envProjectRef: "ref1" })).toEqual({ apply: true });
  });

  it("refuses --apply without --project-ref", () => {
    expect(() => resolveMode({ apply: true, envProjectRef: "ref1" })).toThrow(/--project-ref/);
  });

  it("refuses a --project-ref that does not match the environment, with or without --apply", () => {
    expect(() => resolveMode({ apply: true, projectRef: "other", envProjectRef: "ref1" })).toThrow(/does not match/);
    expect(() => resolveMode({ projectRef: "other", envProjectRef: "ref1" })).toThrow(/does not match/);
  });

  it("does not apply when only --project-ref is given", () => {
    expect(resolveMode({ projectRef: "ref1", envProjectRef: "ref1" })).toEqual({ apply: false });
  });
});

describe("runRestore", () => {
  function liveClient() {
    // Live project today: U1 still exists with its book row (older value); U2 is gone; cover is missing.
    return createFakeClient({
      tables: {
        profiles: [{ id: U1 }],
        reader_settings: [],
        books: [{ id: B1, user_id: U1, title: "old title" }],
        reading_state: [],
        highlights: [],
        bookmarks: [],
      },
      objects: { [`${U1}/${B1}.epub`]: new Uint8Array([1]) },
      authUserIds: [U1],
    });
  }

  it("dry run reports the plan and writes nothing", async () => {
    const live = liveClient();
    const lines: string[] = [];
    const plan = await runRestore({
      client: live.client,
      dir,
      apply: false,
      envProjectRef: "ref1",
      log: (l: string) => lines.push(l),
    });
    expect(live.calls.mutations).toBe(0);
    expect(plan.tables.find((t) => t.name === "books")).toMatchObject({ inserts: 0, updates: 1 });
    expect(plan.missingObjects.map((o: { path: string }) => o.path)).toEqual([`${U1}/${B1}-cover.jpg`]);
    expect(lines.join("\n")).toMatch(/DRY RUN/);
    expect(lines.join("\n")).toMatch(/books: 2 in backup, 0 to insert, 1 to update, 1 skipped/);
  });

  it("skips rows whose user is gone, and children of skipped books, without failing", async () => {
    const live = liveClient();
    const plan = await runRestore({ client: live.client, dir, apply: false, envProjectRef: "ref1" });
    const byName = Object.fromEntries(plan.tables.map((t) => [t.name, t]));
    expect(byName.profiles.skipped.missingUser).toBe(1);
    expect(byName.books.skipped.missingUser).toBe(1);
    expect(byName.reading_state.keep).toHaveLength(1);
    expect(byName.reading_state.skipped.missingUser).toBe(1);
    expect(byName.highlights.skipped.missingBook).toBe(1);
  });

  it("apply upserts in FK order and uploads only missing objects, never overwriting", async () => {
    const live = liveClient();
    await runRestore({ client: live.client, dir, apply: true, envProjectRef: "ref1" });
    const order = live.calls.upserts.map((u) => u.table);
    // highlights (all skipped) and bookmarks (empty) have nothing to write.
    expect(order).toEqual(["profiles", "reader_settings", "books", "reading_state"]);
    expect(live.calls.upserts.find((u) => u.table === "reading_state")!.onConflict).toBe("book_id,user_id");
    expect(live.calls.uploads).toEqual([
      { path: `${U1}/${B1}-cover.jpg`, upsert: false, contentType: "image/jpeg" },
    ]);
    expect(live.tables.get("books")).toEqual([{ id: B1, user_id: U1, title: "one" }]);
  });

  it("batches upserts at 500 rows", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({ id: `b${i}`, user_id: U1, title: "t" }));
    const src = createFakeClient({ tables: { ...tables, books: many, reading_state: [], highlights: [] }, objects: {} });
    const dir2 = join(base, "big");
    await runBackup({ client: src.client, outDir: dir2, projectRef: "ref1" });
    const live = createFakeClient({ authUserIds: [U1, U2] });
    await runRestore({ client: live.client, dir: dir2, apply: true, envProjectRef: "ref1" });
    const bookBatches = live.calls.upserts.filter((u) => u.table === "books").map((u) => u.rows.length);
    expect(bookBatches).toEqual([500, 500, 200]);
  });

  it("aborts before touching the project when a checksum does not match", async () => {
    writeFileSync(join(dir, "tables/books.json"), "[]\n");
    const live = liveClient();
    await expect(runRestore({ client: live.client, dir, apply: true, envProjectRef: "ref1" })).rejects.toThrow(
      /checksum mismatch/,
    );
    expect(live.calls.ranges).toHaveLength(0);
    expect(live.calls.mutations).toBe(0);
  });

  it("refuses an INCOMPLETE backup before touching the project", async () => {
    writeFileSync(join(dir, INCOMPLETE_FILE), "failed\n");
    const live = liveClient();
    await expect(runRestore({ client: live.client, dir, apply: true, envProjectRef: "ref1" })).rejects.toThrow(
      /INCOMPLETE/,
    );
    expect(live.calls.ranges).toHaveLength(0);
    expect(live.calls.mutations).toBe(0);
  });
});
