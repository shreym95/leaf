import { requireUser } from "@/lib/auth";
import { listBooks, countArchivedBooks } from "@/lib/db";
import { AddBooksBar, EmptyState, Shelf } from "@/components/library-ui";
import Link from "next/link";
import { ScreenView } from "@/components/analytics/ScreenView";

/* Auth-gated + per-user data: never prerender this route at build time
   (`requireUser` reads cookies, which already forces dynamic). */
export const dynamic = "force-dynamic";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ hidden?: string }>;
}) {
  const user = await requireUser("/library");
  const showHidden = (await searchParams).hidden === "1";
  const [books, hiddenCount] = await Promise.all([
    listBooks(user.id, { archived: showHidden }),
    countArchivedBooks(user.id),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <ScreenView name="library" />
      <header className="flex flex-col gap-2">
        <p className="font-mono font-medium uppercase text-accent [letter-spacing:var(--leaf-tracking-eyebrow)] [font-size:var(--leaf-text-2xs)]">
          {showHidden ? "Hidden books" : "Your library"}
        </p>
        {books.length > 0 && (
          <h1 className="font-display text-ink [font-size:var(--leaf-text-3xl)]">
            {books.length} {books.length === 1 ? "book" : "books"}
          </h1>
        )}
      </header>

      {showHidden ? (
        <>
          <Link
            href="/library"
            className="self-start rounded-sm font-mono uppercase text-ink-mid transition-colors hover:text-ink [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-label)] [transition-duration:var(--leaf-dur-ui)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
          >
            &larr; Back to your library
          </Link>
          {books.length === 0 ? (
            <p className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)]">
              Nothing is hidden.
            </p>
          ) : (
            <Shelf books={books} />
          )}
        </>
      ) : books.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <AddBooksBar />
          <Shelf books={books} />
        </>
      )}

      {!showHidden && hiddenCount > 0 && (
        <Link
          href="/library?hidden=1"
          className="self-start rounded-sm font-mono uppercase text-faint transition-colors hover:text-ink-mid [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-label)] [transition-duration:var(--leaf-dur-ui)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
        >
          {hiddenCount} hidden {hiddenCount === 1 ? "book" : "books"}
        </Link>
      )}
    </main>
  );
}
