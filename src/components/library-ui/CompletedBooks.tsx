"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { LibraryBook } from "@/lib/db/books";

/**
 * CompletedBooks — the quiet "Completed Books · N" disclosure below the shelf.
 *
 * It must not compete with active and unread books (founder, 2026-10-02), so:
 * collapsed by default into one line of the mono eyebrow style in the faint
 * text colour — no box, no card, no cover art — and, when opened, a compact
 * text list (title, author, finish date) rather than a second grid. Renders
 * nothing at all when there are no completed books.
 *
 * Presentational. The caller passes the books already filtered and ordered
 * (most recently finished first — `partitionCompleted`). The open/closed state
 * is remembered per device in localStorage; every access is wrapped, and a
 * blocked storage just means "collapsed".
 */

export const COMPLETED_OPEN_KEY = "leaf:library:completed-open";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * "2 Oct 2026". Built by hand, in UTC, so the server render and the browser
 * agree (no hydration mismatch across time zones) and the month names do not
 * depend on the runtime's ICU data.
 */
function formatFinished(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(COMPLETED_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(COMPLETED_OPEN_KEY, open ? "1" : "0");
  } catch {
    // storage blocked — the choice holds for this visit only
  }
}

export interface CompletedBooksProps {
  books: LibraryBook[];
}

export function CompletedBooks({ books }: CompletedBooksProps) {
  const panelId = useId();
  // Collapsed on the server and on first paint; the saved preference is applied
  // after mount so the markup always matches.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Reading the saved preference needs the browser, so it can only happen
    // after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(readOpen());
  }, []);

  if (books.length === 0) return null;

  function toggle() {
    const next = !open;
    setOpen(next);
    writeOpen(next);
  }

  return (
    <div className="flex flex-col gap-[var(--leaf-space-2)]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className={clsx(
          "inline-flex items-center gap-[var(--leaf-space-2)] self-start rounded-sm font-mono uppercase text-faint",
          "[font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-label)]",
          "transition-colors hover:text-ink-mid [transition-duration:var(--leaf-dur-ui)]",
          "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]",
        )}
      >
        <svg
          aria-hidden
          viewBox="0 0 8 8"
          className={clsx(
            "h-[0.6em] w-[0.6em] shrink-0 motion-safe:[transition:transform_var(--leaf-dur-ui)_var(--leaf-ease)]",
            open && "rotate-90",
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 1 5.5 4 2.5 7" />
        </svg>
        <span>
          Completed Books
          <span aria-hidden>{" · "}</span>
          <span className="sr-only">, </span>
          {books.length}
        </span>
      </button>

      <ul id={panelId} hidden={!open} className="m-0 flex list-none flex-col p-0">
        {books.map((book) => {
          const date = formatFinished(book.finished_at);
          return (
            <li key={book.id}>
              <Link
                href={`/reader/${book.id}`}
                className={clsx(
                  "flex flex-col gap-[var(--leaf-space-1)] rounded-sm py-[var(--leaf-space-3)]",
                  "sm:flex-row sm:items-baseline sm:gap-[var(--leaf-space-4)]",
                  "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]",
                )}
              >
                <span className="min-w-0 truncate font-display text-ink-mid [font-size:var(--leaf-text-sm)] sm:flex-1">
                  {book.title}
                </span>
                <span className="flex items-baseline justify-between gap-[var(--leaf-space-3)] sm:contents">
                  <span className="min-w-0 truncate font-ui text-faint [font-size:var(--leaf-text-xs)] sm:max-w-[40%]">
                    {book.author}
                  </span>
                  {date && (
                    <span className="flex-none font-mono tabular-nums uppercase text-faint [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-wide)] sm:w-[7rem] sm:text-right">
                      {date}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
