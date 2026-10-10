// Environment loading for the db scripts. No dependencies.
//
// `.env.local` is read from the current working directory when present. Real
// environment variables always win over the file.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Parse `KEY=value` lines. Supports comments, `export`, and single/double quotes. */
export function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2) {
      const end = value.lastIndexOf(quote);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      // Unquoted: a ` #` starts a trailing comment.
      const hash = value.search(/\s#/);
      if (hash !== -1) value = value.slice(0, hash).trimEnd();
    }
    out[key] = value;
  }
  return out;
}

/**
 * Merge `<cwd>/.env.local` into `env` without overriding variables that are
 * already set (and non-empty). Returns the path loaded, or null.
 */
export function loadEnvLocal(cwd = process.cwd(), env = process.env) {
  const file = resolve(cwd, ".env.local");
  if (!existsSync(file)) return null;
  const parsed = parseEnv(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined || env[key] === "") env[key] = value;
  }
  return file;
}

/** The project ref is the first label of `https://<ref>.supabase.co`. */
export function projectRefFromUrl(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }
  const ref = host.split(".")[0];
  if (!ref) throw new Error("Could not read a project ref from NEXT_PUBLIC_SUPABASE_URL.");
  return ref;
}

/** Validate and return the service-role connection settings. */
export function getSupabaseConfig(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const missing = [];
  if (url === "") missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (serviceRoleKey === "") missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    throw new Error(`Missing environment: ${missing.join(", ")}.`);
  }
  return { url, serviceRoleKey, projectRef: projectRefFromUrl(url) };
}
