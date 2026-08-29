// M1: real project + schema. Values are placeholders until then.
//
// Browser Supabase client. The anon key is safe to ship to the client — every
// table is protected by owner-only RLS (SPEC §3.3, §5). Not called in M0.

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
