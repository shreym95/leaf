// POST /api/groups/:groupId/invites  ->  201 { url: "/invite/<token>", expiresAt }
//
// Owner only. A fresh token per call: at least 32 random bytes, base64url,
// valid for 7 days and 4 uses (the group cap is 5 members including the owner).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireGroupsUser, serverError } from "@/lib/groups/server/guard";
import { requireAccess } from "@/lib/groups/server/membership";
import {
  INVITE_DEFAULT_MAX_USES,
  INVITE_TTL_MS,
  mintInviteToken,
} from "@/lib/groups/server/token";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const auth = await requireGroupsUser();
  if (!auth.ok) return auth.response;
  const { groupId } = await params;

  try {
    const admin = createAdminClient();
    const access = await requireAccess(admin, groupId, auth.user.id, "owner");
    if (!access.ok) return access.response;

    const token = mintInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const { error } = await admin.from("group_invites").insert({
      token,
      group_id: groupId,
      created_by: auth.user.id,
      expires_at: expiresAt,
      max_uses: INVITE_DEFAULT_MAX_USES,
    });
    if (error) throw error;

    return NextResponse.json(
      { url: `/invite/${token}`, expiresAt },
      { status: 201 },
    );
  } catch (err) {
    console.error("[/api/groups/:id/invites] create failed", err);
    return serverError("Could not create the invite.");
  }
}
