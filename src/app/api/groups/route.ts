// POST /api/groups  { name }  ->  201 { group: { id, name, createdAt } }
//
// Creates a reading group and the caller's owner membership. Service role:
// clients have no insert policy on `groups` or `group_members`. If the
// membership insert fails the group row is removed again.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  jsonError,
  readJsonObject,
  requireGroupsUser,
  serverError,
} from "@/lib/groups/server/guard";
import { parseGroupName } from "@/lib/groups/server/validate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireGroupsUser();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(request);
  if (!body) return jsonError("Malformed request body.", 400);
  const name = parseGroupName(body.name);
  if (!name) return jsonError("Enter a name of 1 to 60 characters.", 400);

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("groups")
      .insert({ name })
      .select("id, name, created_at")
      .single();
    if (error) throw error;
    const group = data as { id: string; name: string; created_at: string };

    const { error: memberError } = await admin
      .from("group_members")
      .insert({ group_id: group.id, user_id: auth.user.id, role: "owner" });
    if (memberError) {
      await admin.from("groups").delete().eq("id", group.id);
      throw memberError;
    }

    return NextResponse.json(
      {
        group: { id: group.id, name: group.name, createdAt: group.created_at },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[/api/groups] create failed", err);
    return serverError("Could not create the group.");
  }
}
