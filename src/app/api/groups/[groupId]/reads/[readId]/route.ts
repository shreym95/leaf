// DELETE /api/groups/:groupId/reads/:readId  ->  204
//
// Remove a book from a group. Allowed for the group owner and for the member
// who added the read. Copies, progress and milestones go with it (cascade).
//
// PATCH /api/groups/:groupId/reads/:readId  body { schedule }  ->  200 { schedule }
//
// Set or clear the read's checkpoint schedule. Same permission as DELETE. The
// schedule is validated against the read's outline; null or [] clears it (stored
// as null). A caller outside the group, and a read that is not in this group, both
// answer 404 so existence is not revealed.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseOutline } from "@/lib/db/groups";
import { parseSchedule, validateSchedule } from "@/lib/groups/schedule";
import {
  jsonError,
  readJsonObject,
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

export async function PATCH(
  request: Request,
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
      .select("id, created_by, outline")
      .eq("id", readId)
      .eq("group_id", groupId)
      .maybeSingle();
    if (error) throw error;
    const read = data as { id: string; created_by: string | null; outline: unknown } | null;
    if (!read) return jsonError("Read not found.", 404);

    if (role !== "owner" && read.created_by !== auth.user.id) {
      return jsonError(
        "Only the group owner or the member who added it can change this read's schedule.",
        403,
      );
    }

    const body = await readJsonObject(request);
    if (!body || !("schedule" in body)) {
      return jsonError(
        "Send a schedule: a list of checkpoints, or null to clear it.",
        400,
      );
    }
    const checked = validateSchedule(body.schedule, parseOutline(read.outline).length);
    if (!checked.ok) return jsonError(checked.message, 400);

    const { data: updated, error: updateError } = await admin
      .from("group_reads")
      .update({ schedule: checked.schedule })
      .eq("id", readId)
      .eq("group_id", groupId)
      .select("schedule")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return jsonError("Read not found.", 404);

    return NextResponse.json({
      schedule: parseSchedule((updated as { schedule: unknown }).schedule),
    });
  } catch (err) {
    console.error("[/api/groups/:id/reads/:readId] schedule failed", err);
    return serverError("Could not change the schedule.");
  }
}
