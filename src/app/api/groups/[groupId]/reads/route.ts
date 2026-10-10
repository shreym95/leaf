// POST /api/groups/:groupId/reads
//   { title, author?, source, sourceRef?, bookId }
//   ->  201 { read: { id, groupId }, linked, pending }
//
// Member only. `bookId` must be the caller's own book. The outline is built
// server-side from that book's table of contents (labels only are stored) and
// the caller's copy link is created with it. For catalog sources, members who
// already own the book are linked; `pending` counts the rest.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  jsonError,
  readJsonObject,
  requireGroupsUser,
  serverError,
} from "@/lib/groups/server/guard";
import { requireAccess } from "@/lib/groups/server/membership";
import { createGroupRead, parseReadInput } from "@/lib/groups/server/reads";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const auth = await requireGroupsUser();
  if (!auth.ok) return auth.response;
  const { groupId } = await params;

  const body = await readJsonObject(request);
  if (!body) return jsonError("Malformed request body.", 400);
  const parsed = parseReadInput(body);
  if (!parsed.ok) return jsonError(parsed.message, 400);

  try {
    const admin = createAdminClient();
    const access = await requireAccess(admin, groupId, auth.user.id, "member");
    if (!access.ok) return access.response;

    const result = await createGroupRead(
      admin,
      auth.user.id,
      groupId,
      parsed.input,
    );
    if (!result.ok) return jsonError(result.message, result.status);

    return NextResponse.json(
      { read: result.read, linked: result.linked, pending: result.pending },
      { status: 201 },
    );
  } catch (err) {
    console.error("[/api/groups/:id/reads] create failed", err);
    return serverError("Could not add the read.");
  }
}
