import { GROUPS_ENABLED } from "@/lib/groups/flag";
import { Skeleton } from "@/components/ui/Skeleton";

/** Group read fallback: back link, title, then chapter rows. */
export default function GroupReadLoading() {
  if (!GROUPS_ENABLED) return null;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-64" label="Loading read" />
      </header>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i}>
            <Skeleton className="h-8 w-full" />
          </li>
        ))}
      </ul>
    </main>
  );
}
