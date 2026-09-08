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

// Fall back to dummy Supabase config ONLY if `.env.local` did not supply real
// values. This must run AFTER the dotenv load above, not as vitest `test.env`:
// vitest applies `test.env` before setup files, and dotenv does not overwrite
// an already-set variable — so presetting these there silently shadowed the
// real keys and pointed the RLS integration test at a Supabase that isn't
// running.
//
// Why they are needed at all: `IS_DEMO` (src/lib/demo/flag.ts) defaults ON when
// no Supabase env is present, so without these the db/auth/storage tests would
// exercise the demo path instead of the real one.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
