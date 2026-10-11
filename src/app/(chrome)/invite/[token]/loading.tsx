import { GROUPS_ENABLED } from "@/lib/groups/flag";
import { Skeleton } from "@/components/ui/Skeleton";

/** Invite fallback: one line, matching the "Joining…" status. */
export default function InviteLoading() {
  if (!GROUPS_ENABLED) return null;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-10">
      <Skeleton className="h-5 w-24" label="Loading invite" />
    </main>
  );
}
