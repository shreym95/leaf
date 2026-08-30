import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";
import type { BookSource } from "@/lib/types";
import type { LibraryBook } from "@/lib/db/books";
import { BookActions } from "./BookActions";

/**
 * BookCard — one book on the shelf. Presentational only: props in, markup out.
 *
 * The whole card is a single focusable link to the reader, with a visible
 * focus ring. `BookActions` is a sibling of that link, never inside it — a
 * button nested in an anchor is invalid and unreachable by keyboard.
 *
 * Tactile treatment (REVISED_PLAN §3), all built from tokens:
 *   - a spine crease inset along the cover's binding edge
 *     (`--leaf-shadow-spine`), always visible so touch users perceive it too;
 *   - a resting elevation (`--leaf-shadow-card`) that expands on hover
 *     (`--leaf-shadow-card-hover`) with a small lift, the lift suppressed
 *     under `prefers-reduced-motion`;
 *   - an integrated progress meter along the foot of the cover, replacing the
 *     old flat percentage text — still announced to screen readers via the
 *     progressbar's `aria-valuetext`;
 *   - the actions trigger on a frosted disc so it never clashes with busy
 *     cover artwork.
 *
 * Every visual value is a token (mapped utility or `var(--leaf-*)`), never a
 * literal.
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
    <article className="relative hover:z-10">
      {/* One wrapper carries the elevation and the hover lift so the card and
          its actions trigger rise together. */}
      <div
        className={clsx(
          "relative rounded-md",
          "[box-shadow:var(--leaf-shadow-card)] hover:[box-shadow:var(--leaf-shadow-card-hover)]",
          "transition [transition-duration:var(--leaf-dur-ui)] [transition-timing-function:var(--leaf-ease)]",
          // The lift is decoration, not information — gated off under
          // prefers-reduced-motion, where nothing about the card depends on it.
          "motion-safe:hover:-translate-y-1",
        )}
      >
        <Link
          href={`/reader/${book.id}`}
          className={clsx(
            "group flex flex-col gap-3 rounded-md p-3",
            "transition-colors [transition-duration:var(--leaf-dur-ui)] hover:bg-page",
            "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]",
          )}
        >
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-sm border border-rule bg-page [box-shadow:var(--leaf-shadow-spine)]">
            {book.coverUrl ? (
              <Image
                src={book.coverUrl}
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

            {/* Progress ribbon along the foot of the cover. A sighted reader
                reads position from the fill; a screen-reader user gets the
                same words the old text carried via `aria-valuetext`. */}
            <div
              role="progressbar"
              aria-label="Reading progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct ?? 0}
              aria-valuetext={progressLabel}
              className="absolute inset-x-0 bottom-0 h-[var(--leaf-space-1)] bg-page/80 backdrop-blur-sm"
            >
              <span
                aria-hidden
                className="block h-full [background:var(--leaf-accent)] [transition:width_var(--leaf-dur-ui)_var(--leaf-ease-inout)]"
                style={{ width: `${pct ?? 0}%` }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <h3 className="font-display text-ink [font-size:var(--leaf-text-lg)] [line-height:var(--leaf-leading-tight)]">
              {book.title}
            </h3>
            <p className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)]">
              {book.author}
            </p>
            {/* Where a book came from is provenance, not something to scan for —
                smallest type, quietest colour, no tracking. */}
            <p className="font-ui text-faint [font-size:var(--leaf-text-3xs)]">
              {SOURCE_LABEL[book.source]}
            </p>
          </div>
        </Link>

        {/* Outside the <Link>: the card is one focusable link, and a button
            nested in an anchor is invalid and unreachable by keyboard. On a
            frosted disc so it holds up over busy cover artwork. */}
        <div className="absolute right-4 top-4 z-10 rounded-pill bg-page/70 backdrop-blur-md">
          <BookActions
            bookId={book.id}
            title={book.title}
            archived={book.archived_at != null}
          />
        </div>
      </div>
    </article>
  );
}
