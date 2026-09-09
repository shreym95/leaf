import { requireUser } from "@/lib/auth";
import { listBooks, countArchivedBooks } from "@/lib/db";
import {
  AddBooksBar,
  EmptyState,
  HeroCard,
  Shelf,
  splitHeroBook,
} from "@/components/library-ui";
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

  // The "Continue reading" spotlight is the single most recently read book,
  // lifted out of the grid so it never shows twice. Never in the hidden view,
  // and none at all until some book has been opened.
  const { hero, shelf } = splitHeroBook(books, { enabled: !showHidden });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-6 sm:py-10">
      <ScreenView name="library" />
      {/* One compact line, not three stacked blocks. The old header spent an
          eyebrow, a `text-3xl` count and a separate button row on saying
          "library" — which the reader already knows — and pushed the books
          themselves below the fold on a phone. Title and actions now share a
          row and wrap only when they must. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="font-mono font-medium uppercase text-accent [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-eyebrow)]">
          {showHidden ? "Hidden books" : "Your library"}
          {books.length > 0 && (
            <span className="text-faint">
              {" · "}
              {books.length} {books.length === 1 ? "book" : "books"}
            </span>
          )}
        </h1>
        {!showHidden && books.length > 0 && <AddBooksBar />}
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
          {hero && <HeroCard book={hero} />}
          {shelf.length > 0 && (
            <section className="flex flex-col gap-4">
              {/* Only when a spotlight is above it — without one the page
                  header is already the shelf's heading, and a second label
                  would just repeat it. */}
              {hero && (
                <div className="flex items-baseline gap-4 border-b border-rule-soft pb-2">
                  <h2 className="flex-none font-display text-ink [font-size:var(--leaf-text-lg)]">
                    All books
                  </h2>
                  <span className="ml-auto flex-none font-mono uppercase text-faint [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-wide)]">
                    {shelf.length} {shelf.length === 1 ? "volume" : "volumes"}
                  </span>
                </div>
              )}
              <Shelf books={shelf} />
            </section>
          )}
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
