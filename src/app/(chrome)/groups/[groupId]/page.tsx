import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getGroup, listReads } from "@/lib/db/groups";
import { GROUPS_ENABLED } from "@/lib/groups/flag";
import { GroupScreen } from "@/components/groups-ui";

/* Auth-gated + per-user data: never prerender. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Group — Leaf",
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  if (!GROUPS_ENABLED) notFound();
  const { groupId } = await params;
  // A malformed id would reach Postgres as an invalid uuid and throw.
  if (!UUID.test(groupId)) notFound();

  const user = await requireUser(`/groups/${groupId}`);
  const supabase = await createClient();
  const detail = await getGroup(groupId, supabase);
  if (!detail || !detail.members.some((m) => m.user_id === user.id)) notFound();

  const reads = await listReads(groupId, supabase);
  // Owner first, then by join order.
  const members = [...detail.members].sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return a.joined_at.localeCompare(b.joined_at);
  });

  return (
    <GroupScreen
      groupId={groupId}
      name={detail.group.name}
      currentUserId={user.id}
      members={members}
      reads={reads.map((r) => ({ id: r.id, title: r.title, author: r.author }))}
    />
  );
}
