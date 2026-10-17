// Backup logic, separated from process concerns so it can run against a mock client.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  INCOMPLETE_FILE,
  MANIFEST_FILE,
  buildManifest,
  objectFile,
  safeJoin,
  sha256,
  tableFile,
} from "./manifest.mjs";
import { fetchAllRows, listAllObjects } from "./paginate.mjs";
import { BUCKET, TABLES } from "./tables.mjs";
import { selectTables } from "./select-tables.mjs";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

function writeFile(path, bytes) {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  writeFileSync(path, bytes, { mode: FILE_MODE });
}

/** Default folder name: UTC timestamp without characters that are awkward in paths. */
export function timestampName(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
}

/**
 * Back up every core table and every bucket object into `outDir` (which must already
 * have passed the path guard). With `tableNames`, back up only those tables (any
 * known table, see select-tables.mjs) and skip bucket objects. Throws, leaving an
 * INCOMPLETE marker, if anything failed. On success the marker is removed and
 * `manifest.json` is written last.
 * @param {{ client: any, outDir: string, projectRef: string, tableNames?: string[] | null, now?: () => Date, log?: (message: string) => void }} args
 */
export async function runBackup({
  client,
  outDir,
  projectRef,
  tableNames = null,
  now = () => new Date(),
  log = (_message) => {},
}) {
  const scoped = tableNames !== null;
  const tableDefs = scoped ? selectTables(tableNames) : TABLES;
  mkdirSync(outDir, { recursive: true, mode: DIR_MODE });
  if (readdirSync(outDir).length > 0) {
    throw new Error(`Output directory "${outDir}" is not empty.`);
  }
  const startedAt = now().toISOString();
  const markerPath = join(outDir, INCOMPLETE_FILE);
  writeFile(markerPath, `Backup started ${startedAt} and has not finished.\n`);

  const errors = [];
  const tables = {};

  for (const table of tableDefs) {
    try {
      const rows = await fetchAllRows(client, table.name, table.pk);
      const bytes = Buffer.from(JSON.stringify(rows, null, 2) + "\n", "utf8");
      const file = tableFile(table.name);
      writeFile(join(outDir, file), bytes);
      tables[table.name] = { file, rows: rows.length, sha256: sha256(bytes) };
      log(`table ${table.name}: ${rows.length} rows`);
    } catch (err) {
      errors.push(`table ${table.name}: ${err.message}`);
      log(`table ${table.name}: FAILED (${err.message})`);
    }
  }

  const objects = [];
  let paths = [];
  if (scoped) {
    log("storage: skipped (scoped backup)");
  } else {
    try {
      paths = await listAllObjects(client, BUCKET);
    } catch (err) {
      errors.push(`storage list: ${err.message}`);
      log(`storage list: FAILED (${err.message})`);
    }
  }

  for (const path of paths) {
    try {
      const file = objectFile(BUCKET, path);
      const target = safeJoin(outDir, file);
      const { data, error } = await client.storage.from(BUCKET).download(path);
      if (error) throw new Error(error.message ?? String(error));
      if (!data) throw new Error("empty response");
      const bytes = Buffer.from(await data.arrayBuffer());
      writeFile(target, bytes);
      objects.push({ path, file, size: bytes.length, sha256: sha256(bytes) });
    } catch (err) {
      errors.push(`object ${path}: ${err.message}`);
      log(`object ${path}: FAILED (${err.message})`);
    }
  }
  if (!scoped) log(`storage: ${objects.length}/${paths.length} objects`);

  if (errors.length > 0) {
    writeFile(
      markerPath,
      `Backup started ${startedAt} and FAILED. Do not restore from this directory.\n\n` +
        errors.map((e) => `- ${e}`).join("\n") +
        "\n",
    );
    const error = new Error(`Backup incomplete: ${errors.length} error(s).\n  - ${errors.join("\n  - ")}`);
    error.errors = errors;
    throw error;
  }

  const manifest = buildManifest({
    projectRef,
    createdAt: startedAt,
    bucket: BUCKET,
    tables,
    objects,
    scope: {
      scoped,
      tables: tableDefs.map((t) => t.name),
      storage: !scoped,
    },
  });
  writeFile(join(outDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
  rmSync(markerPath);
  return manifest;
}
