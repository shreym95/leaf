// Typed convenience wrappers over the `profiles` table. Server-side only.
// Security is RLS (owner-only, SPEC §3.3) — these helpers add types, not checks.

import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** The signed-in user's profile row, or null if it doesn't exist yet. */
export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}

/**
 * Idempotent upsert of the profile row. The signup trigger
 * (`handle_new_user`) already creates it; this is belt-and-braces for callers
 * that can't assume the trigger ran (tests, backfills, first render races).
 * `displayName` is only written when provided — an existing name is preserved.
 */
export async function ensureProfile(
  userId: string,
  displayName?: string,
): Promise<Profile> {
  const supabase = await createClient();
  const row: { id: string; display_name?: string } = { id: userId };
  if (displayName !== undefined) row.display_name = displayName;

  const { data, error } = await supabase
    .from("profiles")
    .upsert(row, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as Profile;
}
