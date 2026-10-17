// Table selection for scoped backups and restores.

import { EXTRA_TABLES } from "./extra-tables.mjs";
import { TABLES } from "./tables.mjs";

/** Every table the scripts know, in restore order (core FK order, then extras). */
export const ALL_TABLES = [...TABLES, ...EXTRA_TABLES];
export const ALL_TABLE_NAMES = ALL_TABLES.map((t) => t.name);

/**
 * Turn a list of table names into table definitions, in restore order (parents
 * first), without duplicates. Unknown or empty names are refused, listing the valid ones.
 */
export function selectTables(names) {
  const valid = `Valid tables: ${ALL_TABLE_NAMES.join(", ")}.`;
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error(`No tables named. ${valid}`);
  }
  const unknown = names.filter((n) => !ALL_TABLE_NAMES.includes(n));
  if (unknown.length > 0) {
    throw new Error(`Unknown table(s): ${unknown.map((n) => JSON.stringify(n)).join(", ")}. ${valid}`);
  }
  const wanted = new Set(names);
  return ALL_TABLES.filter((t) => wanted.has(t.name));
}

/** Parse the value of `--tables a,b,c` into table names, in restore order. */
export function parseTableList(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`--tables needs a comma-separated list. Valid tables: ${ALL_TABLE_NAMES.join(", ")}.`);
  }
  const names = value.split(",").map((n) => n.trim());
  if (names.some((n) => n === "")) {
    throw new Error(`--tables has an empty name in "${value}". Valid tables: ${ALL_TABLE_NAMES.join(", ")}.`);
  }
  return selectTables(names).map((t) => t.name);
}
