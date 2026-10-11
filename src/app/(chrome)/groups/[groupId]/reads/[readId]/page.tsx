import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getGroup,
  getMyCopy,
  getReadProgress,
  listMilestones,
  listReads,
} from "@/lib/db/groups";
import { GROUPS_ENABLED } from "@/lib/groups/flag";
import { ReadScreen } from "@/components/groups-ui";

/* Auth-gated + per-user data: never prerender. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Group read — Leaf",
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GroupReadPage({
  params,
}: {
  params: Promise<{ groupId: string; readId: string }>;
}) {
  if (!GROUPS_ENABLED) notFound();
  const { groupId, readId } = await params;
  // A malformed id would reach Postgres as an invalid uuid and throw.
  if (!UUID.test(groupId) || !UUID.test(readId)) notFound();

  const user = await requireUser(`/groups/${groupId}/reads/${readId}`);
  const supabase = await createClient();
  const detail = await getGroup(groupId, supabase);
  if (!detail || !detail.members.some((m) => m.user_id === user.id)) notFound();

  const reads = await listReads(groupId, supabase);
  const read = reads.find((r) => r.id === readId);
  if (!read) notFound();

  const [progress, milestones, copy] = await Promise.all([
    getReadProgress(readId, supabase),
    listMilestones(readId, supabase),
    getMyCopy(user.id, readId, supabase),
  ]);

  // Owner first, then by join order.
  const members = [...detail.members].sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return a.joined_at.localeCompare(b.joined_at);
  });

  return (
    <ReadScreen
      groupId={groupId}
      groupName={detail.group.name}
      currentUserId={user.id}
      read={{
        id: read.id,
        title: read.title,
        author: read.author,
        source: read.source,
        outline: read.outline,
      }}
      members={members}
      progress={progress}
      milestones={milestones}
      copy={
        copy
          ? { bookId: copy.bookId, confidence: copy.alignment?.confidence ?? null }
          : null
      }
    />
  );
}
