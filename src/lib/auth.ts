// Server-side auth helpers (SPEC §3.3). Style-agnostic: no design/component imports.
//
// Route protection is enforced in the root proxy (src/proxy.ts →
// updateSession). `requireUser()` is a defence-in-depth guard for Server
// Components / Server Actions / Route Handlers that must not run without a user
// (Next's own docs recommend checking auth in the handler, not only the proxy).

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "./supabase/server";

async function fetchUser(): Promise<User | null> {
  if (!isSupabaseConfigured) {
    return null;
  }
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    // Network error, malformed cookie, or misconfiguration — treat as signed out
    // so SSR degrades to the logged-out view instead of crashing.
    return null;
  }
}

/**
 * The signed-in Supabase user, or `null` when signed out / env not yet wired.
 *
 * Uses Supabase's `getUser()` (which revalidates the JWT with the auth server)
 * rather than `getSession()`, per their server-side guidance — so each call is a
 * network round trip. `cache()` memoises it for the lifetime of ONE request, so
 * a page and its NavBar (and any layout in between) share a single call instead
 * of each paying that round trip. It is not a cross-request cache: every new
 * request still revalidates.
 */
export const getUser = cache(fetchUser);

/**
 * Return the signed-in user or redirect to `/login` (preserving the intended
 * destination in `?next=`). Use in any server route that requires auth.
 */
export async function requireUser(nextPath?: string): Promise<User> {
  const user = await getUser();
  if (!user) {
    redirect(
      nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login",
    );
  }
  return user;
}
