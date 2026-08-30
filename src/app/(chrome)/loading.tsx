import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Fallback for the chrome routes that don't ship their own (settings, privacy,
 * styleguide). Generic on purpose — those pages differ too much for one shape
 * to flatter all of them, so this just acknowledges the tap with the page's
 * usual measure and rhythm. `library` has its own, closer-fitting version.
 */
export default function ChromeLoading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <Skeleton className="h-3 w-24" label="Loading" />
      <Skeleton className="h-9 w-64" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </main>
  );
}
