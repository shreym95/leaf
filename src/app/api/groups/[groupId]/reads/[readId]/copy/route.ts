// POST /api/groups/:groupId/reads/:readId/copy
//   { bookId? }  ->  200 { linked, imported, alignment: { confidence } | null }
// DELETE /api/groups/:groupId/reads/:readId/copy  ->  204
//
// Member only. POST gives the caller their own copy of the read and aligns it
// with the read's outline. Without `bookId` a catalog read uses the caller's
// existing copy or imports it; with `bookId` the book must be the caller's own.
// DELETE unlinks only the caller's copy: the book stays in their library and
// their read progress is kept. Repeating it is safe.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  jsonError,
  requireGroupsUser,
  serverError,
} from "@/lib/groups/server/guard";
import { isUuid, requireAccess } from "@/lib/groups/server/membership";
import { getMyCopy, removeMyCopy } from "@/lib/groups/server/my-copy";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ groupId: string; readId: string }> },
) {
  const auth = await requireGroupsUser();
  if (!auth.ok) return auth.response;
  const { groupId, readId } = await params;

  // The body is optional; when there is one it must be a JSON object.
  let bookId: string | null = null;
  const raw = await request.text();
  if (raw.trim() !== "") {
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError("Malformed request body.", 400);
    }
    const fields = body as Record<string, unknown>;
    if (fields.bookId !== undefined && fields.bookId !== null) {
      if (!isUuid(fields.bookId)) return jsonError("Choose a book.", 400);
      bookId = fields.bookId;
    }
  }

  try {
    const admin = createAdminClient();
    const access = await requireAccess(admin, groupId, auth.user.id, "member");
    if (!access.ok) return access.response;
    if (!isUuid(readId)) return jsonError("Read not found.", 404);

    const result = await getMyCopy(admin, auth.user.id, groupId, readId, bookId);
    if (!result.ok) return jsonError(result.message, result.status);

    return NextResponse.json({
      linked: result.linked,
      imported: result.imported,
      alignment: result.alignment,
    });
  } catch (err) {
    console.error("[/api/groups/:id/reads/:readId/copy] failed", err);
    return serverError("Could not add your copy.");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ groupId: string; readId: string }> },
) {
  const auth = await requireGroupsUser();
  if (!auth.ok) return auth.response;
  const { groupId, readId } = await params;

  try {
    const admin = createAdminClient();
    const access = await requireAccess(admin, groupId, auth.user.id, "member");
    if (!access.ok) return access.response;
    if (!isUuid(readId)) return jsonError("Read not found.", 404);

    const result = await removeMyCopy(admin, auth.user.id, groupId, readId);
    if (!result.ok) return jsonError(result.message, result.status);

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[/api/groups/:id/reads/:readId/copy] remove failed", err);
    return serverError("Could not remove your copy.");
  }
}
