import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";
import type { BookSource } from "@/lib/types";
import type { LibraryBook } from "@/lib/db/books";

/**
 * BookCard — one book on the shelf. Presentational only: props in, markup out.
 * The whole card is a single focusable link to the reader, with a visible
 * focus ring. Every visual value is a token (mapped utility or `var(--leaf-*)`),
 * never a literal.
 */

export interface BookCardProps {
  book: LibraryBook;
}

const SOURCE_LABEL: Record<BookSource, string> = {
  standardebooks: "Standard Ebooks",
  gutenberg: "Project Gutenberg",
  upload: "Upload",
};

export function BookCard({ book }: BookCardProps) {
  const initial = book.title.trim().charAt(0).toUpperCase() || "?";

  // Progress, not a status label: "Reading" was true of nearly every book and
  // said nothing. A percentage says where you actually are.
  const pct =
    book.percent == null
      ? null
      : Math.min(100, Math.max(0, Math.round(book.percent * 100)));
  const progressLabel =
    pct == null ? "Not started" : pct >= 100 ? "Finished" : `${pct}%`;

  return (
    <article>
      <Link
        href={`/reader/${book.id}`}
        className={clsx(
          "group flex flex-col gap-3 rounded-md p-3",
          "transition-colors [transition-duration:var(--leaf-dur-ui)] hover:bg-page",
          "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]",
        )}
      >
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-sm border border-rule bg-page">
          {book.cover_url ? (
            <Image
              src={book.cover_url}
              alt={`Cover of ${book.title}`}
              fill
              sizes="(min-width: 40rem) 12rem, 45vw"
              className="object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-full w-full items-center justify-center font-display text-faint [font-size:var(--leaf-text-3xl)]"
            >
              {initial}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <h3 className="font-display text-ink [font-size:var(--leaf-text-lg)] [line-height:var(--leaf-leading-tight)]">
            {book.title}
          </h3>
          <p className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)]">
            {book.author}
          </p>
          <p className="font-mono uppercase text-ink-mid [letter-spacing:var(--leaf-tracking-label)] [font-size:var(--leaf-text-2xs)]">
            {progressLabel}
          </p>
          {/* Where a book came from is provenance, not something to scan for —
              smallest type, quietest colour, no tracking. */}
          <p className="font-ui text-faint [font-size:var(--leaf-text-3xs)]">
            {SOURCE_LABEL[book.source]}
          </p>
        </div>
      </Link>
    </article>
  );
}
