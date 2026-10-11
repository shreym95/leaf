import { GROUPS_ENABLED } from "@/lib/groups/flag";
import { Skeleton } from "@/components/ui/Skeleton";

/** Groups list fallback: mirrors the header and the list rows. */
export default function GroupsLoading() {
  if (!GROUPS_ENABLED) return null;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <header>
        <Skeleton className="h-9 w-40" label="Loading groups" />
      </header>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i}>
            <Skeleton className="h-14 w-full" />
          </li>
        ))}
      </ul>
    </main>
  );
}
