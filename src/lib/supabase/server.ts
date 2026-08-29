// Server Supabase client (SPEC §2, §3.3), bound to the request's cookies so
// Supabase Auth can read — and, in Route Handlers / Server Actions, refresh —
// the session during SSR.
//
// @supabase/ssr 0.12 cookie API: `getAll` / `setAll` (the old get/set/remove
// trio is deprecated and misses edge cases — see the package's own JSDoc).
//
// Exported name `createClient` is a contract with the db layer (Agent A).
// It stays an async function returning a SupabaseClient.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SupabaseNotConfiguredError } from "./client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True once both public Supabase env vars are present. */
export const isSupabaseConfigured =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/**
 * Create a request-scoped server Supabase client. Never cache or share the
 * returned client across requests.
 *
 * Throws `SupabaseNotConfiguredError` when env is not yet wired. Server helpers
 * (`getUser` / `requireUser` in src/lib/auth.ts) guard with
 * `isSupabaseConfigured` first so SSR keeps working before the keys land.
 */
export async function createClient() {
  if (!isSupabaseConfigured) {
    throw new SupabaseNotConfiguredError();
  }

  // Next 16: the cookie store is async.
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Thrown when called from a Server Component (read-only cookie store).
          // Safe to ignore: the root proxy (src/proxy.ts) refreshes the session
          // and writes cookies on every request.
        }
      },
    },
  });
}
