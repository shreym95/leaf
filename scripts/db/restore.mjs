#!/usr/bin/env node
// Restore a backup made by backup.mjs.
//
//   npm run db:restore -- <backup dir>                              dry run (default)
//   npm run db:restore -- <backup dir> --apply --project-ref <ref>  write
//
// Upserts rows in foreign-key order, uploads only objects missing from the
// bucket (never overwrites), never deletes. Rows whose user no longer exists
// in auth are skipped and reported.

import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { getSupabaseConfig, loadEnvLocal } from "./lib/env.mjs";
import { resolveMode, runRestore } from "./lib/restore-core.mjs";

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      "project-ref": { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length !== 1) {
    throw new Error("Usage: npm run db:restore -- <backup dir> [--apply --project-ref <ref>]");
  }
  loadEnvLocal();
  const { url, serviceRoleKey, projectRef: envProjectRef } = getSupabaseConfig();
  const { apply } = resolveMode({
    apply: values.apply,
    projectRef: values["project-ref"],
    envProjectRef,
  });

  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  console.log(`Project ${envProjectRef}`);
  await runRestore({
    client,
    dir: resolve(positionals[0]),
    apply,
    envProjectRef,
    log: (m) => console.log(m),
  });
  if (!apply) console.log("Dry run only. Add --apply --project-ref <ref> to write.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
