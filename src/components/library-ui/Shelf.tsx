import type { Book } from "@/lib/types";
import { BookCard } from "./BookCard";

/**
 * Shelf — responsive grid of BookCards. Presentational only; no logic beyond
 * mapping. Layout via CSS grid auto-fill/minmax so cards reflow at every width;
 * gap from Tailwind's spacing scale.
 */

export interface ShelfProps {
  books: Book[];
}

export function Shelf({ books }: ShelfProps) {
  return (
    <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-6 p-0">
      {books.map((book) => (
        <li key={book.id}>
          <BookCard book={book} />
        </li>
      ))}
    </ul>
  );
}
