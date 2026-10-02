"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/primitives";

/**
 * EndOfBookPanel — what lies after the last page.
 *
 * Presentational + token-driven. It stands in for the page view inside the book
 * frame (the parent positions it over the viewer), on the reader's own surface,
 * so it replaces the prose rather than floating over it. Deliberately quiet: the
 * reader chrome's mono eyebrow, the display face for the title, hairline-weight
 * actions, no motion at all.
 *
 * Two states, one layout. `finished` shows the "Finished" eyebrow, the finish
 * date when the parent knows it, and "Mark as unread". Otherwise the eyebrow is
 * "The end" and the same slot offers "Mark as finished" — the manual override
 * for the cases the conservative completion rule deliberately misses.
 *
 * Accessibility: a labelled region; the heading takes focus on mount (the
 * parent returns focus to the frame on close); the status/finish switch is
 * announced politely through a status node; every action is a real button or
 * link. No focus trap — this is in-page, not a modal.
 */

export interface EndOfBookPanelProps {
  title: string;
  author: string;
  finished: boolean;
  /** When the book was finished, if known. Omitted from the panel when null. */
  finishedOn?: Date | null;
  /** Dismiss the panel and stay on the last page. */
  onClose: () => void;
  onMarkFinished: () => void;
  onMarkUnread: () => void;
}

const eyebrowClass =
  "font-mono uppercase text-faint [font-size:var(--leaf-text-2xs)] " +
  "[letter-spacing:var(--leaf-tracking-label)]";

function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function EndOfBookPanel({
  title,
  author,
  finished,
  finishedOn = null,
  onClose,
  onMarkFinished,
  onMarkUnread,
}: EndOfBookPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Empty until the reader acts, so the status node is a live region that
  // CHANGES (announced) rather than one that is merely inserted (often not).
  const [note, setNote] = useState("");

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      aria-label="End of book"
      className="absolute inset-0 z-[11] flex flex-col items-center justify-center gap-[var(--leaf-space-5)] overflow-y-auto bg-page px-[var(--leaf-space-6)] py-[var(--leaf-space-6)] text-center"
    >
      <div className="flex max-w-[var(--leaf-reader-measure)] flex-col items-center gap-[var(--leaf-space-3)]">
        <p className={eyebrowClass}>{finished ? "Finished" : "The end"}</p>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-ink text-balance break-words outline-none [font-size:var(--leaf-text-2xl)] [line-height:var(--leaf-leading-tight)]"
        >
          {title}
        </h2>
        {author && (
          <p className="font-body text-ink-mid [font-size:var(--leaf-text-lg)]">
            {author}
          </p>
        )}
        {finished && finishedOn && (
          <p className={eyebrowClass}>
            <time dateTime={isoDay(finishedOn)}>
              {finishedOn.toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-[var(--leaf-space-2)]">
        <Button asChild variant="ghost" size="md">
          <Link href="/library">Back to library</Link>
        </Button>
        <Button variant="quiet" size="md" onClick={onClose}>
          Back to the last page
        </Button>
        {/* One element for both states, so focus survives the flip. */}
        <Button
          variant="quiet"
          size="md"
          onClick={() => {
            if (finished) {
              setNote("Marked as unread.");
              onMarkUnread();
            } else {
              setNote("Marked as finished.");
              onMarkFinished();
            }
          }}
        >
          {finished ? "Mark as unread" : "Mark as finished"}
        </Button>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {note}
      </p>
    </section>
  );
}
