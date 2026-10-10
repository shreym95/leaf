// Restore logic. Dry run unless `apply` is true. Never deletes, never overwrites
// a storage object. Auth users are not restored: rows whose user is gone are skipped.

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { safeJoin, verifyBackup } from "./manifest.mjs";
import { fetchAllRows, listAllObjects, listAuthUserIds } from "./paginate.mjs";
import { BUCKET, TABLES, UPSERT_BATCH } from "./tables.mjs";

const CONTENT_TYPES = {
  ".epub": "application/epub+zip",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * Decide the mode from the CLI flags and the env project ref. Applying needs
 * both `--apply` and a `--project-ref` equal to the env's. Anything else that
 * asks for an apply is refused, not quietly downgraded.
 */
/** @param {{ apply?: boolean, projectRef?: string, envProjectRef: string }} args */
export function resolveMode({ apply = false, projectRef, envProjectRef }) {
  if (projectRef !== undefined && projectRef !== envProjectRef) {
    throw new Error(
      `--project-ref "${projectRef}" does not match the project in the environment ` +
        `("${envProjectRef}"). Refusing.`,
    );
  }
  if (apply && projectRef === undefined) {
    throw new Error("--apply requires --project-ref <ref> (the ref of the project in the environment).");
  }
  return { apply: apply === true && projectRef === envProjectRef };
}

function keyOf(row, pk) {
  return pk.map((c) => String(row[c])).join("|");
}

function readRows(dir, entry) {
  return JSON.parse(readFileSync(safeJoin(dir, entry.file), "utf8"));
}

/**
 * Build the plan: per table, which rows insert / update / are skipped, and which
 * storage objects are missing. Read-only against the live project.
 */
export async function planRestore({ client, dir, manifest }) {
  for (const name of Object.keys(manifest.tables)) {
    if (!TABLES.some((t) => t.name === name)) {
      throw new Error(`Backup contains an unknown table "${name}"; this restore script does not know its foreign-key order.`);
    }
  }
  const userIds = await listAuthUserIds(client);
  const keptBookIds = new Set();
  const tables = [];

  for (const table of TABLES) {
    const entry = manifest.tables[table.name];
    if (!entry) continue;
    const rows = readRows(dir, entry);
    const existing = new Set(
      (await fetchAllRows(client, table.name, table.pk, { columns: table.pk.join(",") })).map((r) => keyOf(r, table.pk)),
    );
    const keep = [];
    const skipped = { missingUser: 0, missingBook: 0 };
    let inserts = 0;
    let updates = 0;
    for (const row of rows) {
      if (table.userColumn && !userIds.has(row[table.userColumn])) {
        skipped.missingUser += 1;
        continue;
      }
      if (table.bookColumn && !keptBookIds.has(row[table.bookColumn])) {
        skipped.missingBook += 1;
        continue;
      }
      keep.push(row);
      if (existing.has(keyOf(row, table.pk))) updates += 1;
      else inserts += 1;
    }
    if (table.name === "books") for (const row of keep) keptBookIds.add(row.id);
    tables.push({ name: table.name, pk: table.pk, total: rows.length, keep, inserts, updates, skipped });
  }

  const bucketPaths = new Set(await listAllObjects(client, BUCKET));
  const objects = manifest.storage?.objects ?? [];
  for (const obj of objects) {
    if (obj.path.split("/").some((seg) => seg === ".." || seg === "") || obj.path.startsWith("/")) {
      throw new Error(`Unsafe object path in manifest: ${JSON.stringify(obj.path)}`);
    }
  }
  const missingObjects = objects.filter((o) => !bucketPaths.has(o.path));
  return { tables, objectTotal: objects.length, missingObjects };
}

export function describePlan(plan, { apply }) {
  const lines = [apply ? "APPLY" : "DRY RUN (nothing will be written)"];
  for (const t of plan.tables) {
    const skipped = t.skipped.missingUser + t.skipped.missingBook;
    let line = `${t.name}: ${t.total} in backup, ${t.inserts} to insert, ${t.updates} to update`;
    if (skipped > 0) {
      line += `, ${skipped} skipped (${t.skipped.missingUser} user not in auth, ${t.skipped.missingBook} book skipped)`;
    }
    lines.push(line);
  }
  lines.push(`storage ${BUCKET}: ${plan.objectTotal} in backup, ${plan.missingObjects.length} missing from bucket`);
  for (const o of plan.missingObjects) lines.push(`  missing: ${o.path}`);
  return lines;
}

async function applyPlan({ client, dir, plan, log }) {
  for (const t of plan.tables) {
    for (let i = 0; i < t.keep.length; i += UPSERT_BATCH) {
      const batch = t.keep.slice(i, i + UPSERT_BATCH);
      const { error } = await client.from(t.name).upsert(batch, { onConflict: t.pk.join(",") });
      if (error) throw new Error(`${t.name}: upsert failed: ${error.message ?? String(error)}`);
    }
    log(`${t.name}: upserted ${t.keep.length}`);
  }

  const errors = [];
  let uploaded = 0;
  for (const obj of plan.missingObjects) {
    const bytes = readFileSync(safeJoin(dir, obj.file));
    const { error } = await client.storage.from(BUCKET).upload(obj.path, bytes, {
      upsert: false,
      contentType: CONTENT_TYPES[extname(obj.path).toLowerCase()] ?? "application/octet-stream",
    });
    if (error) errors.push(`object ${obj.path}: ${error.message ?? String(error)}`);
    else uploaded += 1;
  }
  log(`storage ${BUCKET}: uploaded ${uploaded}/${plan.missingObjects.length}`);
  if (errors.length > 0) {
    throw new Error(`Restore finished with ${errors.length} upload error(s).\n  - ${errors.join("\n  - ")}`);
  }
}

/**
 * Verify, plan, and (only when `apply`) execute. Verification happens before
 * any call to the live project.
 */
export async function runRestore({ client, dir, apply, envProjectRef, log = (_message) => {} }) {
  const manifest = verifyBackup(dir);
  if (manifest.projectRef !== envProjectRef) {
    log(`warning: backup is from project "${manifest.projectRef}", environment is "${envProjectRef}".`);
  }
  const plan = await planRestore({ client, dir, manifest });
  for (const line of describePlan(plan, { apply })) log(line);
  if (apply) await applyPlan({ client, dir, plan, log });
  return plan;
}
