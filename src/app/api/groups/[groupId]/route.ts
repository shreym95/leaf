// PATCH /api/groups/:groupId  { name }  ->  200 { group: { id, name } }   (owner only)

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  jsonError,
  readJsonObject,
  requireGroupsUser,
  serverError,
} from "@/lib/groups/server/guard";
import { requireAccess } from "@/lib/groups/server/membership";
import { parseGroupName } from "@/lib/groups/server/validate";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const auth = await requireGroupsUser();
  if (!auth.ok) return auth.response;
  const { groupId } = await params;

  const body = await readJsonObject(request);
  if (!body) return jsonError("Malformed request body.", 400);
  const name = parseGroupName(body.name);
  if (!name) return jsonError("Enter a name of 1 to 60 characters.", 400);

  try {
    const admin = createAdminClient();
    const access = await requireAccess(admin, groupId, auth.user.id, "owner");
    if (!access.ok) return access.response;

    const { data, error } = await admin
      .from("groups")
      .update({ name })
      .eq("id", groupId)
      .select("id, name");
    if (error) throw error;
    const row = (data as Array<{ id: string; name: string }> | null)?.[0];
    if (!row) return jsonError("Not found.", 404);

    return NextResponse.json({ group: { id: row.id, name: row.name } });
  } catch (err) {
    console.error("[/api/groups/:id] rename failed", err);
    return serverError("Could not rename the group.");
  }
}
