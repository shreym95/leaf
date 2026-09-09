import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";
import { Button } from "@/components/primitives";
import type { LibraryBook } from "@/lib/db/books";

/**
 * HeroCard — the "Continue reading" spotlight pinned above the shelf grid for
 * the single most recently read book (REVISED_PLAN §9A, design iteration 1).
 *
 * Presentational only: props in, markup out. The only interactive element is
 * the CTA, which is a real `<Link>` to the reader — the card itself does not
 * lift or react to hover, because nothing about it is clickable except that
 * link.
 *
 * Cover treatment matches the shelf card (`docs/DESIGN.md` §11): a fixed 2:3
 * footprint, `object-contain` so the whole cover shows, any letterbox falling
 * on the card ground (`bg-page`) rather than a crop or a bar — and the same
 * `--leaf-crease` spine gradient, here at `--leaf-hero-crease-w` (12px).
 *
 * The handoff drew a `3/4` cover; 2:3 is deliberate (DEFECTS D3 — cropping
 * covers was the bug, and 2:3 is the ratio nearly every real cover ships at).
 *
 * Every visual value is a token (mapped utility or `var(--leaf-*)`), never a
 * literal.
 */

export interface HeroCardProps {
  book: LibraryBook;
}

/**
 * Split the library into its hero and the books that stay on the grid.
 *
 * The hero is the single book with the most recent `lastReadAt`. `listBooks`
 * already returns the shelf most-recently-read first, but the hero is picked
 * explicitly here so it can't drift if that ordering ever changes. The hero is
 * removed from `shelf` so it never appears twice.
 *
 * `enabled: false` (the `?hidden=1` view) returns no hero and the books
 * untouched. When no book has ever been opened there is no hero either — the
 * shelf renders grid-only.
 */
export function splitHeroBook(
  books: LibraryBook[],
  { enabled = true }: { enabled?: boolean } = {},
): { hero: LibraryBook | null; shelf: LibraryBook[] } {
  if (!enabled) return { hero: null, shelf: books };

  let picked: LibraryBook | null = null;
  for (const book of books) {
    if (!book.lastReadAt) continue;
    if (picked === null || book.lastReadAt > (picked.lastReadAt ?? "")) {
      picked = book;
    }
  }

  if (picked === null) return { hero: null, shelf: books };
  const hero = picked;
  return { hero, shelf: books.filter((b) => b.id !== hero.id) };
}

export function HeroCard({ book }: HeroCardProps) {
  const initial = book.title.trim().charAt(0).toUpperCase() || "?";

  const pct =
    book.percent == null
      ? null
      : Math.min(100, Math.max(0, Math.round(book.percent * 100)));

  return (
    <section
      aria-label="Continue reading"
      className={clsx(
        "relative flex flex-col items-center gap-5 rounded-md border border-rule bg-page p-6",
        "[box-shadow:var(--leaf-shadow-card)]",
        "sm:flex-row sm:gap-6",
      )}
    >
      {/* Cover — fixed 2:3, whole cover shown, letterbox on the card ground. */}
      <div className="relative aspect-[2/3] w-[var(--leaf-hero-cover-w)] shrink-0 overflow-hidden rounded-sm border border-rule bg-page">
        {book.coverUrl ? (
          <Image
            src={book.coverUrl}
            alt={`Cover of ${book.title}`}
            fill
            sizes="130px"
            className="object-contain"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-full w-full items-center justify-center font-display text-faint [font-size:var(--leaf-text-3xl)]"
          >
            {initial}
          </span>
        )}

        {/* Spine crease — a soft shadow down the binding edge, over the art. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-[var(--leaf-hero-crease-w)] [background-image:var(--leaf-crease)]"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="font-mono font-medium uppercase text-accent [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-eyebrow)]">
          Continue reading
        </p>

        <h2 className="font-display text-ink [font-size:var(--leaf-text-2xl)] [line-height:var(--leaf-leading-tight)]">
          {book.title}
        </h2>

        <p className="font-ui text-ink-mid [font-size:var(--leaf-text-base)]">
          {book.author}
        </p>

        {/* Progress track + percent. Time-remaining and a chapter label are
            deliberately absent — neither is stored, and the shelf will not open
            an EPUB to derive them (REVISED_PLAN §9A). */}
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-label="Reading progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? 0}
            aria-valuetext={`${pct ?? 0}% complete`}
            className="h-[var(--leaf-space-1)] flex-1 overflow-hidden rounded-pill bg-rule"
          >
            <span
              aria-hidden
              className="block h-full rounded-pill [background:var(--leaf-accent)] [transition:width_var(--leaf-dur-ui)_var(--leaf-ease-inout)]"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
          <span className="font-mono tabular-nums text-faint [font-size:var(--leaf-text-xs)]">
            {pct ?? 0}%
          </span>
        </div>

        <Button asChild variant="primary" className="mt-1 self-start">
          <Link href={`/reader/${book.id}`}>
            Continue Reading
            <span aria-hidden>&rarr;</span>
          </Link>
        </Button>
      </div>
    </section>
  );
}
