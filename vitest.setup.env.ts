// Load `.env.local` (if it exists) before any test module is evaluated, so the
// RLS integration test picks up real Supabase keys when they're present.
// No-op in CI / anywhere without the file. Does not override vars already set
// in the environment (dotenv's default).

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

const envLocal = resolve(process.cwd(), ".env.local");
if (existsSync(envLocal)) {
  config({ path: envLocal });
}
