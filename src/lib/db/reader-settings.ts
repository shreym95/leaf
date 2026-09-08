// Typed convenience wrappers over the `reader_settings` table. Server-side only.
// Security is RLS (owner-only, SPEC §3.3 / §5) — the explicit `user_id` filters
// are belt-and-braces, not the security boundary.

import { createClient } from "@/lib/supabase/server";
import type { ReaderSettings } from "@/lib/types";
import { IS_DEMO } from "@/lib/demo/flag";

/**
 * The user's reading settings row. The signup trigger (`handle_new_user`) seeds
 * one per user, so this normally returns a row; `null` only before the trigger
 * has run (races, backfills) — callers fall back to the store defaults.
 */
export async function getReaderSettings(
  userId: string,
): Promise<ReaderSettings | null> {
  // Demo mode: no row — the client store falls back to its defaults and then
  // hydrates from localStorage (see `src/store/reader-settings.ts`).
  if (IS_DEMO) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reader_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ReaderSettings | null) ?? null;
}

/** Columns a client is allowed to change (everything except the PK). */
export type ReaderSettingsPatch = Partial<Omit<ReaderSettings, "user_id">>;

/**
 * Idempotent upsert of the reading-settings row. Used by server callers; the
 * live reader persists from the browser (RLS-protected) via the Supabase client
 * in the store.
 */
export async function upsertReaderSettings(
  userId: string,
  patch: ReaderSettingsPatch,
): Promise<ReaderSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reader_settings")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as ReaderSettings;
}
