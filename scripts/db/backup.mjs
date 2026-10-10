#!/usr/bin/env node
// Back up the live Supabase project's public tables and the `epubs` bucket.
//
//   npm run db:backup [-- --out <dir>]
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env, or .env.local
// in the current directory). Default output: ~/leaf-backups/<UTC timestamp>/.
// Output inside the git repository is refused.

import { createClient } from "@supabase/supabase-js";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runBackup, timestampName } from "./lib/backup-core.mjs";
import { getSupabaseConfig, loadEnvLocal } from "./lib/env.mjs";
import { assertOutsideRepo } from "./lib/path-guard.mjs";

async function main() {
  const { values } = parseArgs({ options: { out: { type: "string" } }, strict: true });
  loadEnvLocal();
  const { url, serviceRoleKey, projectRef } = getSupabaseConfig();

  const requested = values.out ?? join(homedir(), "leaf-backups", timestampName());
  const outDir = assertOutsideRepo(requested);

  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Project ${projectRef}; writing to ${outDir}`);
  const manifest = await runBackup({ client, outDir, projectRef, log: (m) => console.log(m) });

  const rows = Object.values(manifest.tables).reduce((n, t) => n + t.rows, 0);
  console.log(`Backup complete: ${rows} rows, ${manifest.storage.objectCount} objects.`);
  console.log(`Verify, then keep it safe: ${outDir}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
