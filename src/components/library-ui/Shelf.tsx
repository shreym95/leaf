import type { LibraryBook } from "@/lib/db/books";
import { BookCard } from "./BookCard";

/**
 * Shelf — responsive grid of BookCards. Presentational only; no logic beyond
 * mapping. Fixed column counts: 3 on mobile, 4 from the tablet breakpoint,
 * 5 on desktop — replacing the old `auto-fill/minmax`, which drifted between
 * 3 and 5 depending on the viewport.
 *
 * The counts are one higher than the handoff's 2/3/4 on purpose. At 4 columns
 * inside `max-w-5xl` a cover was ~230px wide and each book read as a poster;
 * the spotlight above is what should carry weight, and the shelf is meant to be
 * scanned. Five columns puts a cover near the ~145px the prototype draws.
 *
 * The hero book, when there is one, is removed upstream (`splitHeroBook`) so it
 * never appears here as well.
 */

export interface ShelfProps {
  books: LibraryBook[];
}

export function Shelf({ books }: ShelfProps) {
  return (
    <ul className="grid list-none grid-cols-3 gap-x-5 gap-y-8 p-0 sm:grid-cols-4 lg:grid-cols-5">
      {books.map((book) => (
        <li key={book.id}>
          <BookCard book={book} />
        </li>
      ))}
    </ul>
  );
}
