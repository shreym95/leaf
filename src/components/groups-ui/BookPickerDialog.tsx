"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
} from "@/components/primitives";
import { titlesMatch } from "@/lib/groups/copy-match";
import type { OwnBook, OwnBooksState } from "./useOwnBooks";
import { bodyClass, errorClass, labelClass } from "./styles";

export interface BookPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  books: OwnBooksState;
  /** Resolves on success; throw an Error to show its message in the dialog. */
  onPick: (book: OwnBook) => Promise<void>;
  /**
   * Upload a new EPUB and resolve once it is the caller's pick. Omit to hide the upload
   * option. Throw an Error to show its message in the dialog.
   */
  onUpload?: (file: File) => Promise<void>;
  /** A book to leave out of the list, such as the copy that is already linked. */
  excludeBookId?: string;
  /** The group read's title. Books that match it are listed first and tagged. */
  matchTitle?: string;
}

const matchTagClass =
  "font-mono uppercase text-accent [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-label)]";

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Lists the caller's own books; choosing one runs `onPick` and closes on success.
 * With `onUpload`, an EPUB can be uploaded instead. With `matchTitle`, books that
 * look like the group read are listed first.
 */
export function BookPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  books,
  onPick,
  onUpload,
  excludeBookId,
  matchTitle,
}: BookPickerDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Bumped on every open change, so a result from an earlier session never sets state here.
  const sessionRef = useRef(0);
  const errorId = useId();
  const busy = pendingId !== null || uploading;

  useEffect(() => {
    sessionRef.current += 1;
  }, [open]);

  function handleOpenChange(next: boolean) {
    // A pick or upload in flight owns the dialog until it settles.
    if (!next && busy) return;
    onOpenChange(next);
    if (!next) {
      setError(null);
      setPendingId(null);
    }
  }

  async function pick(book: OwnBook) {
    if (pendingId || uploading) return;
    const session = sessionRef.current;
    const live = () => sessionRef.current === session;
    setPendingId(book.id);
    setError(null);
    try {
      await onPick(book);
      if (live()) onOpenChange(false);
    } catch (err) {
      if (live()) setError(messageOf(err, "Something went wrong."));
    } finally {
      setPendingId(null);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow re-picking the same file later.
    e.target.value = "";
    if (!file || !onUpload || uploading || pendingId) return;
    const session = sessionRef.current;
    const live = () => sessionRef.current === session;
    setUploading(true);
    setError(null);
    try {
      await onUpload(file);
      if (live()) onOpenChange(false);
    } catch (err) {
      if (live()) setError(messageOf(err, "Upload failed. Please try again."));
    } finally {
      setUploading(false);
    }
  }

  const visibleBooks =
    books.kind === "ready" ? books.books.filter((b) => b.id !== excludeBookId) : [];
  const isMatch = (b: OwnBook) => Boolean(matchTitle) && titlesMatch(b.title, matchTitle ?? "");
  const listedBooks = matchTitle
    ? [
        ...visibleBooks.filter(isMatch),
        ...visibleBooks.filter((b) => !isMatch(b)),
      ]
    : visibleBooks;
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent title={title} description={description}>
        <div className="flex flex-col gap-4">
          {books.kind === "loading" || books.kind === "idle" ? (
            <p role="status" className={bodyClass}>
              Loading your books.
            </p>
          ) : null}
          {books.kind === "error" ? (
            <p role="alert" className={errorClass}>
              Could not load your books.
            </p>
          ) : null}
          {books.kind === "ready" && books.books.length === 0 ? (
            <p className={bodyClass}>Your library is empty.</p>
          ) : null}
          {books.kind === "ready" &&
          books.books.length > 0 &&
          visibleBooks.length === 0 ? (
            <p className={bodyClass}>No other books in your library.</p>
          ) : null}
          {listedBooks.length > 0 ? (
            <ul
              aria-label="Your books"
              aria-describedby={error ? errorId : undefined}
              className="m-0 flex max-h-72 list-none flex-col overflow-y-auto p-0"
            >
              {listedBooks.map((b) => (
                <li key={b.id} className="border-b border-rule-soft">
                  <button
                    type="button"
                    onClick={() => pick(b)}
                    disabled={busy}
                    className="flex w-full flex-col items-start gap-0.5 rounded-sm py-2 text-left transition-colors hover:bg-edge disabled:opacity-40 [transition-duration:var(--leaf-dur-ui)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
                  >
                    {isMatch(b) ? (
                      <span className={matchTagClass}>Matches this book</span>
                    ) : null}
                    <span className={labelClass}>{b.title}</span>
                    {b.author ? <span className={bodyClass}>{b.author}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {onUpload ? (
            <div className="flex flex-col items-start gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                Upload an EPUB
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".epub,application/epub+zip"
                hidden
                aria-label="Upload an EPUB file"
                onChange={handleFile}
              />
            </div>
          ) : null}
          {uploading ? (
            <p role="status" className={bodyClass}>
              Uploading…
            </p>
          ) : null}
          {error ? (
            <p id={errorId} role="alert" className={errorClass}>
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
