// Typed convenience wrappers over the `books` table. Server-side only.
// Security is RLS (owner-only, SPEC §3.3) — the explicit `user_id` filters are
// belt-and-braces and keep the queries readable, not the security boundary.

import { createClient } from "@/lib/supabase/server";
import type { Book } from "@/lib/types";

/** The user's library, newest first. */
export async function listBooks(userId: string): Promise<Book[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });
  if (error) throw error;
  return (data as Book[] | null) ?? [];
}

/** A single book by id, or null if it doesn't exist / isn't the user's. */
export async function getBook(
  userId: string,
  bookId: string,
): Promise<Book | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .eq("user_id", userId)
    .eq("id", bookId)
    .maybeSingle();
  if (error) throw error;
  return (data as Book | null) ?? null;
}
