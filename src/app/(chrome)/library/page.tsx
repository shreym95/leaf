import { requireUser } from "@/lib/auth";
import { listBooks } from "@/lib/db";
import { AddBooksBar, EmptyState, Shelf } from "@/components/library-ui";
import { ScreenView } from "@/components/analytics/ScreenView";

/* Auth-gated + per-user data: never prerender this route at build time
   (`requireUser` reads cookies, which already forces dynamic). */
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const user = await requireUser("/library");
  const books = await listBooks(user.id);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <ScreenView name="library" />
      <header className="flex flex-col gap-2">
        <p className="font-mono font-medium uppercase text-accent [letter-spacing:var(--leaf-tracking-eyebrow)] [font-size:var(--leaf-text-2xs)]">
          Your library
        </p>
        {books.length > 0 && (
          <h1 className="font-display text-ink [font-size:var(--leaf-text-3xl)]">
            {books.length} {books.length === 1 ? "book" : "books"}
          </h1>
        )}
      </header>

      {books.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <AddBooksBar />
          <Shelf books={books} />
        </>
      )}
    </main>
  );
}
