// Browser Supabase client (SPEC §2, §3.3).
//
// The anon key is safe to ship to the client — every table is protected by
// owner-only RLS (SPEC §5). This client persists the session in cookies (via
// @supabase/ssr) so the server can read it during SSR.
//
// Env is wired by the founder in parallel (M1). Until the keys land,
// `isSupabaseConfigured` is false and callers must degrade gracefully rather
// than construct a client (createBrowserClient throws on empty url/key).

import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True once both public Supabase env vars are present. */
export const isSupabaseConfigured =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/**
 * Create a browser Supabase client. Throws `SupabaseNotConfiguredError` when the
 * env is not yet wired — guard with `isSupabaseConfigured` before calling from
 * UI (see GoogleSignInButton, which shows an error state instead).
 */
export function createClient() {
  if (!isSupabaseConfigured) {
    throw new SupabaseNotConfiguredError();
  }
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase environment is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}
