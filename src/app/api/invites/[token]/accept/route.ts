// POST /api/invites/:token/accept
//   ->  200 { groupId, alreadyMember, linked, imported, failed: [{ readId, title }] }
//
// Join the group the token belongs to. Order: token exists, caller already a
// member (idempotent 200), not expired, a use is available (compare-and-set),
// membership insert (the database cap raises 23514 when full). On success each
// catalog read gets the member's copy: an existing non-archived book with the
// same source + source_ref is linked, otherwise the book is imported. Import
// failures do not fail the accept; they come back in `failed`.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  jsonError,
  requireGroupsUser,
  serverError,
} from "@/lib/groups/server/guard";
import { getMemberRole } from "@/lib/groups/server/membership";
import {
  claimInviteUse,
  loadInvite,
  releaseInviteUse,
} from "@/lib/groups/server/invites";
import { isPlausibleInviteToken } from "@/lib/groups/server/token";
import {
  isCatalogSource,
  linkOrImportCatalogReads,
  type CatalogRead,
} from "@/lib/groups/server/link-or-import";

export const runtime = "nodejs";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const auth = await requireGroupsUser();
  if (!auth.ok) return auth.response;
  const { token } = await params;

  if (!isPlausibleInviteToken(token)) {
    return jsonError("This invite is not valid.", 404);
  }

  try {
    const admin = createAdminClient();
    const invite = await loadInvite(admin, token);
    if (!invite) return jsonError("This invite is not valid.", 404);

    const groupId = invite.group_id;
    const userId = auth.user.id;

    if (await getMemberRole(admin, groupId, userId)) {
      return NextResponse.json({
        groupId,
        alreadyMember: true,
        linked: 0,
        imported: 0,
        failed: [],
      });
    }

    const claim = await claimInviteUse(admin, invite);
    if (!claim.ok) {
      switch (claim.reason) {
        case "expired":
          return jsonError("This invite has expired.", 410);
        case "used_up":
          return jsonError("This invite has been used up.", 410);
        case "busy":
          return jsonError("Could not join right now. Try again.", 409);
        default:
          return jsonError("This invite is not valid.", 404);
      }
    }

    const { error: joinError } = await admin
      .from("group_members")
      .insert({ group_id: groupId, user_id: userId, role: "member" });
    if (joinError) {
      await releaseInviteUse(admin, token);
      if (joinError.code === CHECK_VIOLATION) {
        return jsonError("This group is full.", 409);
      }
      if (joinError.code === UNIQUE_VIOLATION) {
        // A parallel request for the same user won the insert.
        return NextResponse.json({
          groupId,
          alreadyMember: true,
          linked: 0,
          imported: 0,
          failed: [],
        });
      }
      throw joinError;
    }

    const { data: reads, error: readsError } = await admin
      .from("group_reads")
      .select("id, title, source, source_ref, outline")
      .eq("group_id", groupId)
      .in("source", ["standardebooks", "gutenberg"]);
    if (readsError) throw readsError;

    const catalogReads = ((reads ?? []) as Array<{
      id: string;
      title: string;
      source: string;
      source_ref: string | null;
      outline: unknown;
    }>).filter(
      (r): r is CatalogRead =>
        isCatalogSource(r.source) && typeof r.source_ref === "string",
    );
    const copies = await linkOrImportCatalogReads(admin, userId, catalogReads);

    return NextResponse.json({
      groupId,
      alreadyMember: false,
      linked: copies.linked,
      imported: copies.imported,
      failed: copies.failed,
    });
  } catch (err) {
    console.error("[/api/invites/:token/accept] failed", err);
    return serverError("Could not join the group.");
  }
}
