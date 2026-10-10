// Manifest, checksums and backup-integrity checks.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const MANIFEST_FILE = "manifest.json";
export const INCOMPLETE_FILE = "INCOMPLETE";
export const MANIFEST_VERSION = 1;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Local file name for a table's export. */
export function tableFile(name) {
  return `tables/${name}.json`;
}

/** Local file name for a bucket object. */
export function objectFile(bucket, objectPath) {
  return `storage/${bucket}/${objectPath}`;
}

/** Join `rel` under `dir`, refusing anything that would escape it. */
export function safeJoin(dir, rel) {
  if (typeof rel !== "string" || rel === "" || isAbsolute(rel)) {
    throw new Error(`Unsafe path in manifest: ${JSON.stringify(rel)}`);
  }
  const full = resolve(dir, rel);
  const back = relative(resolve(dir), full);
  if (back === "" || back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) {
    throw new Error(`Unsafe path in manifest: ${JSON.stringify(rel)}`);
  }
  return full;
}

export function buildManifest({ projectRef, createdAt, bucket, tables, objects }) {
  return {
    version: MANIFEST_VERSION,
    projectRef,
    createdAt,
    tables, // { [name]: { file, rows, sha256 } }
    storage: { bucket, objectCount: objects.length, objects }, // objects: [{ path, file, size, sha256 }]
  };
}

export function readManifest(dir) {
  const file = join(dir, MANIFEST_FILE);
  if (!existsSync(file)) throw new Error(`No ${MANIFEST_FILE} in "${dir}".`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${MANIFEST_FILE} is not valid JSON: ${err.message}`);
  }
  if (manifest?.version !== MANIFEST_VERSION) {
    throw new Error(`Unsupported manifest version: ${manifest?.version}.`);
  }
  return manifest;
}

/**
 * Verify a backup directory before anything is restored. Throws on an INCOMPLETE
 * marker, a missing manifest, a missing file, a checksum mismatch, or a row
 * count that does not match the manifest. Returns the manifest.
 */
export function verifyBackup(dir) {
  if (existsSync(join(dir, INCOMPLETE_FILE))) {
    throw new Error(`"${dir}" is marked INCOMPLETE (the backup did not finish). Refusing to use it.`);
  }
  const manifest = readManifest(dir);
  const problems = [];

  for (const [name, entry] of Object.entries(manifest.tables ?? {})) {
    let bytes;
    try {
      bytes = readFileSync(safeJoin(dir, entry.file));
    } catch (err) {
      problems.push(`${name}: cannot read ${entry.file} (${err.message})`);
      continue;
    }
    if (sha256(bytes) !== entry.sha256) {
      problems.push(`${name}: checksum mismatch for ${entry.file}`);
      continue;
    }
    let rows;
    try {
      rows = JSON.parse(bytes.toString("utf8"));
    } catch {
      problems.push(`${name}: ${entry.file} is not valid JSON`);
      continue;
    }
    if (!Array.isArray(rows) || rows.length !== entry.rows) {
      problems.push(`${name}: manifest says ${entry.rows} rows, file has ${Array.isArray(rows) ? rows.length : "no array"}`);
    }
  }

  const objects = manifest.storage?.objects ?? [];
  if (objects.length !== manifest.storage?.objectCount) {
    problems.push(`storage: manifest says ${manifest.storage?.objectCount} objects, lists ${objects.length}`);
  }
  for (const obj of objects) {
    let bytes;
    try {
      bytes = readFileSync(safeJoin(dir, obj.file));
    } catch (err) {
      problems.push(`object ${obj.path}: cannot read ${obj.file} (${err.message})`);
      continue;
    }
    if (sha256(bytes) !== obj.sha256) problems.push(`object ${obj.path}: checksum mismatch`);
  }

  if (problems.length > 0) {
    throw new Error(`Backup verification failed:\n  - ${problems.join("\n  - ")}`);
  }
  return manifest;
}
