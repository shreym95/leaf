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
 * Tactile treatment (REVISED_PLAN §3 / §9A), all built from tokens:
 *   - a spine crease down the cover's binding edge — the `--leaf-crease`
 *     gradient at `--leaf-card-crease-w` (10px), always visible so touch users
 *     perceive it too;
 *   - a resting elevation (`--leaf-shadow-card`) that expands on hover
 *     (`--leaf-shadow-card-hover`) with a small lift, the lift suppressed
 *     under `prefers-reduced-motion`;
 *   - a state label — `UNREAD` / `NN% READ` / `COMPLETED` — as plain words
 *     under the author. Design iteration 1 dropped the fill ribbon that used to
 *     sit on the cover: it duplicated what the label says and sat over the art;
 *   - the actions trigger on a frosted disc so it never clashes with busy
 *     cover artwork;
 *   - the cover shown whole (`object-contain`) in a fixed 2:3 footprint, any
 *     letterbox falling on the card ground rather than a crop or a bar.
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

  // One state word, not a bar: where you are in a book reads fine as text on a
  // shelf, and it does not sit over the cover art (design iteration 1, §9A).
  const pct =
    book.percent == null
      ? null
      : Math.min(100, Math.max(0, Math.round(book.percent * 100)));
  const stateLabel =
    pct == null || pct === 0
      ? "UNREAD"
      : pct >= 100
        ? "COMPLETED"
        : `${pct}% READ`;

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
          {/* The card footprint is 2:3 — the ratio nearly every trade book
              cover is published at — so `object-contain` shows the cover whole
              with no visible letterbox for the common case. It was 3:4, which
              left pale bands down both sides of every normal cover. Odd-ratio
              covers still letterbox onto the card ground (`bg-page`), reading as
              the book resting on a page rather than a UI artifact. */}
          <div className="relative aspect-[2/3] w-full overflow-hidden rounded-sm border border-rule bg-page">
            {book.coverUrl ? (
              <Image
                src={book.coverUrl}
                alt={`Cover of ${book.title}`}
                fill
                sizes="(min-width: 40rem) 12rem, 45vw"
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

            {/* Spine crease — a soft shadow down the binding edge, painted over
                the cover art. Decorative; the same gradient the hero uses. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-[var(--leaf-card-crease-w)] [background-image:var(--leaf-crease)]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <h3 className="font-display text-ink [font-size:var(--leaf-text-lg)] [line-height:var(--leaf-leading-tight)]">
              {book.title}
            </h3>
            <p className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)]">
              {book.author}
            </p>
            {/* Where the reader is in the book, as one word. `UNREAD` covers
                both "never opened" and "opened, no progress" — the distinction
                the old ribbon drew was noise on a shelf. */}
            <p className="font-mono uppercase text-faint [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-wide)]">
              {stateLabel}
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
