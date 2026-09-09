import type { LibraryBook } from "@/lib/db/books";
import { BookCard } from "./BookCard";

/**
 * Shelf — responsive grid of BookCards. Presentational only; no logic beyond
 * mapping. Fixed column counts (design iteration 1, REVISED_PLAN §9A): 2 on
 * mobile, 3 from the tablet breakpoint, 4 on desktop — replacing the old
 * `auto-fill/minmax`, which drifted between 3 and 5 columns depending on the
 * viewport. The hero book, when there is one, is removed upstream
 * (`splitHeroBook`) so it never appears here as well.
 */

export interface ShelfProps {
  books: LibraryBook[];
}

export function Shelf({ books }: ShelfProps) {
  return (
    <ul className="grid list-none grid-cols-2 gap-6 p-0 sm:grid-cols-3 lg:grid-cols-4">
      {books.map((book) => (
        <li key={book.id}>
          <BookCard book={book} />
        </li>
      ))}
    </ul>
  );
}
