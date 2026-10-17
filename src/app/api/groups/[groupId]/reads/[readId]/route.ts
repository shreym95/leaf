// DELETE /api/groups/:groupId/reads/:readId  ->  204
//
// Remove a book from a group. Allowed for the group owner and for the member
// who added the read. Copies, progress and milestones go with it (cascade).
// A caller outside the group, and a read that is not in this group, both
// answer 404 so existence is not revealed.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  jsonError,
  requireGroupsUser,
  serverError,
} from "@/lib/groups/server/guard";
import { getMemberRole, isUuid } from "@/lib/groups/server/membership";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ groupId: string; readId: string }> },
) {
  const auth = await requireGroupsUser();
  if (!auth.ok) return auth.response;
  const { groupId, readId } = await params;

  try {
    const admin = createAdminClient();
    const role = await getMemberRole(admin, groupId, auth.user.id);
    if (!role || !isUuid(readId)) return jsonError("Read not found.", 404);

    const { data, error } = await admin
      .from("group_reads")
      .select("id, created_by")
      .eq("id", readId)
      .eq("group_id", groupId)
      .maybeSingle();
    if (error) throw error;
    const read = data as { id: string; created_by: string | null } | null;
    if (!read) return jsonError("Read not found.", 404);

    if (role !== "owner" && read.created_by !== auth.user.id) {
      return jsonError(
        "Only the group owner or the member who added it can remove this book.",
        403,
      );
    }

    const { error: deleteError } = await admin
      .from("group_reads")
      .delete()
      .eq("id", readId)
      .eq("group_id", groupId);
    if (deleteError) throw deleteError;

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[/api/groups/:id/reads/:readId] remove failed", err);
    return serverError("Could not remove the book.");
  }
}
