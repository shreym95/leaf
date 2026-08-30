import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Library fallback. Every route here is server-rendered on demand (the nav
 * shows signed-in state), so a tap used to leave the old page on screen with no
 * acknowledgement until the new one arrived — which read as a dead tap.
 *
 * The shape mirrors `page.tsx`: eyebrow, heading, the add-books row, then a
 * shelf grid, so the real content settles into place rather than replacing a
 * different-looking screen. The real eyebrow is shown for real — it is the same
 * on every load, so there is nothing to guess at.
 */
export default function LibraryLoading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <p className="font-mono font-medium uppercase text-accent [letter-spacing:var(--leaf-tracking-eyebrow)] [font-size:var(--leaf-text-2xs)]">
          Your library
        </p>
        <Skeleton className="h-9 w-40" label="Loading your library" />
      </header>

      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>

      <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-6 p-0">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex flex-col gap-2">
            <Skeleton className="aspect-[3/4] w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </li>
        ))}
      </ul>
    </main>
  );
}
