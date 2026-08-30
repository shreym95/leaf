// Service-role Supabase client — SERVER ONLY (SPEC §3.3).
//
// This client uses `SUPABASE_SERVICE_ROLE_KEY` and therefore BYPASSES Row-Level
// Security. It must never reach the browser bundle. Two guards enforce that:
//
//   1. `import "server-only"` — Next aliases this to a module that throws at
//      build time if it is pulled into a Client Component graph (see
//      node_modules/next/dist/build/webpack-config.js; the bare `server-only`
//      npm package is not installed, Next provides it). It also has a
//      `declare module "server-only"` ambient type so `tsc` is happy.
//   2. A runtime `typeof window` guard below — belt-and-braces for any bundler
//      path that slips past the build-time check.
//
// The only sanctioned caller is the account-deletion Route Handler
// (src/app/api/account/delete/route.ts). Do not import this anywhere else
// without the same server-only scrutiny.

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

if (typeof window !== "undefined") {
  throw new Error(
    "src/lib/supabase/admin.ts was imported in the browser. The service-role " +
      "key must never reach the client.",
  );
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/**
 * Create a service-role Supabase client. Bypasses RLS — use only in trusted
 * server code that has already authenticated and authorised the caller.
 *
 * Throws if the server env is not configured. The key is read from
 * `process.env.SUPABASE_SERVICE_ROLE_KEY` and is never logged.
 */
export function createAdminClient(): SupabaseClient {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (SUPABASE_URL.length === 0 || serviceRoleKey.length === 0) {
    throw new Error(
      "Supabase service-role env is not configured " +
        "(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
    );
  }

  return createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
