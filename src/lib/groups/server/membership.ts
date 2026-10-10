// Membership and ownership checks. Run with the service-role client, so the
// handler (not RLS) is the guard: every caller passes the session user's id.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import type { GroupRole } from "@/lib/types";
import { jsonError } from "./guard";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** The user's role in the group, or null when they are not a member. Throws on a DB error. */
export async function getMemberRole(
  admin: SupabaseClient,
  groupId: string,
  userId: string,
): Promise<GroupRole | null> {
  if (!isUuid(groupId)) return null;
  const { data, error } = await admin
    .from("group_members")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as { role: GroupRole } | null)?.role ?? null;
}

export type Access =
  | { ok: true; role: GroupRole }
  | { ok: false; response: NextResponse };

/**
 * Require the caller to belong to the group (`need: "member"`) or to own it
 * (`need: "owner"`). A group that does not exist answers the same as a group
 * the caller is not in.
 */
export async function requireAccess(
  admin: SupabaseClient,
  groupId: string,
  userId: string,
  need: "member" | "owner",
): Promise<Access> {
  const role = await getMemberRole(admin, groupId, userId);
  if (!role) {
    return {
      ok: false,
      response: jsonError("You are not a member of this group.", 403),
    };
  }
  if (need === "owner" && role !== "owner") {
    return {
      ok: false,
      response: jsonError("Only the group owner can do this.", 403),
    };
  }
  return { ok: true, role };
}
