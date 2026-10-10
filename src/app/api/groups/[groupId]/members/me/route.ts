// DELETE /api/groups/:groupId/members/me  ->  200 { ok: true }
//
// Leave a group. Database triggers hand ownership to the longest-standing
// member, delete the group when nobody is left, and remove the leaver's
// progress, milestones and copy links.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  jsonError,
  requireGroupsUser,
  serverError,
} from "@/lib/groups/server/guard";
import { isUuid } from "@/lib/groups/server/membership";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const auth = await requireGroupsUser();
  if (!auth.ok) return auth.response;
  const { groupId } = await params;
  if (!isUuid(groupId)) {
    return jsonError("You are not a member of this group.", 403);
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", auth.user.id)
      .select("user_id");
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) {
      return jsonError("You are not a member of this group.", 403);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/groups/:id/members/me] leave failed", err);
    return serverError("Could not leave the group.");
  }
}
