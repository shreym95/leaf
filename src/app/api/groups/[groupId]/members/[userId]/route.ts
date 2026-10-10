// DELETE /api/groups/:groupId/members/:userId  ->  200 { ok: true }   (owner only)
//
// Remove another member. The owner cannot remove themselves here; leaving is
// `DELETE .../members/me`.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  jsonError,
  requireGroupsUser,
  serverError,
} from "@/lib/groups/server/guard";
import { isUuid, requireAccess } from "@/lib/groups/server/membership";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ groupId: string; userId: string }> },
) {
  const auth = await requireGroupsUser();
  if (!auth.ok) return auth.response;
  const { groupId, userId } = await params;

  try {
    const admin = createAdminClient();
    const access = await requireAccess(admin, groupId, auth.user.id, "owner");
    if (!access.ok) return access.response;

    if (userId === auth.user.id) {
      return jsonError("Use leave to exit your own group.", 400);
    }
    if (!isUuid(userId)) return jsonError("Not a member of this group.", 404);

    const { data, error } = await admin
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .select("user_id");
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) {
      return jsonError("Not a member of this group.", 404);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/groups/:id/members/:userId] remove failed", err);
    return serverError("Could not remove the member.");
  }
}
