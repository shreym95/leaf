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
