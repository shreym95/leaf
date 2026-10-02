import type { Book } from "@/lib/types";

/**
 * The one rule for "finished": the recorded status, and nothing else.
 *
 * Reading position is deliberately not consulted. Progress that rounds to 100%
 * is not a completion (back matter keeps real finishes below it, and a reader
 * who marks a book unread at 99.6% must see it as unread). The reader writes
 * `status = 'finished'` (with `finished_at`) when it decides the book is done;
 * the shelf, the hero and the Completed Books section all defer to that.
 */
export function isBookFinished(book: Pick<Book, "status">): boolean {
  return book.status === "finished";
}

/**
 * Split a library into the books for the main shelf and the Completed Books
 * section.
 *
 * Completed = `isBookFinished` AND not archived: a book that is both archived
 * and finished belongs to the hidden view only, so it never surfaces in
 * Completed Books. Completed books are ordered most recently finished first
 * (`finished_at` descending; a missing date sorts last, ties keep the incoming
 * order). `rest` keeps the incoming order untouched.
 */
export function partitionCompleted<
  T extends Pick<Book, "status" | "finished_at" | "archived_at">,
>(books: T[]): { rest: T[]; completed: T[] } {
  const rest: T[] = [];
  const completed: T[] = [];
  for (const book of books) {
    if (isBookFinished(book) && book.archived_at == null) completed.push(book);
    else rest.push(book);
  }
  completed.sort((a, b) => {
    if (a.finished_at && b.finished_at) {
      return b.finished_at.localeCompare(a.finished_at);
    }
    if (a.finished_at) return -1;
    if (b.finished_at) return 1;
    return 0;
  });
  return { rest, completed };
}
