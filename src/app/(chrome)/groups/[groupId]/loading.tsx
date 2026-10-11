import { GROUPS_ENABLED } from "@/lib/groups/flag";
import { Skeleton } from "@/components/ui/Skeleton";

/** Group page fallback: back link, title, then member rows. */
export default function GroupLoading() {
  if (!GROUPS_ENABLED) return null;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-56" label="Loading group" />
      </header>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i}>
            <Skeleton className="h-8 w-full" />
          </li>
        ))}
      </ul>
    </main>
  );
}
