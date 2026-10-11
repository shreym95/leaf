import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMyGroups } from "@/lib/db/groups";
import { GROUPS_ENABLED } from "@/lib/groups/flag";
import { GroupsScreen } from "@/components/groups-ui";

/* Auth-gated + per-user data: never prerender. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Groups — Leaf",
};

export default async function GroupsPage() {
  if (!GROUPS_ENABLED) notFound();
  const user = await requireUser("/groups");
  const supabase = await createClient();
  const mine = await listMyGroups(user.id, supabase);

  return (
    <GroupsScreen
      groups={mine.map((m) => ({
        id: m.group.id,
        name: m.group.name,
        memberCount: m.memberCount,
        role: m.role,
      }))}
    />
  );
}
