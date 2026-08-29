// M1: real project + schema. Values are placeholders until then.
//
// Server Supabase client, bound to the request's cookies so Supabase Auth can
// read and refresh the session during SSR / Route Handlers. Not called in M0.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  // Next 16: the cookie store is async.
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component, where the cookie store is
            // read-only. Session refresh is handled by middleware in M1.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // See note in set().
          }
        },
      },
    },
  );
}

// ---------------------------------------------------------------------------
// !!! SERVER-ONLY. NEVER import this into a Client Component or any file that
// !!! ships to the browser. The service-role key bypasses Row-Level Security
// !!! entirely — leaking it hands every user's data to anyone. It must only be
// !!! read from a server env var inside a Route Handler / server action.
// Wired in M1 (delete-account cleanup, admin tasks). Left commented so it
// cannot be imported by accident.
// ---------------------------------------------------------------------------
//
// import { createClient as createSupabaseClient } from "@supabase/supabase-js";
//
// export function createServiceClient() {
//   return createSupabaseClient(
//     process.env.NEXT_PUBLIC_SUPABASE_URL!,
//     process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only secret
//     { auth: { autoRefreshToken: false, persistSession: false } },
//   );
// }
