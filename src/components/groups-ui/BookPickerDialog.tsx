"use client";

import { useId, useState } from "react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
} from "@/components/primitives";
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
}

/** Lists the caller's own books; choosing one runs `onPick` and closes on success. */
export function BookPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  books,
  onPick,
}: BookPickerDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const errorId = useId();

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setError(null);
      setPendingId(null);
    }
  }

  async function pick(book: OwnBook) {
    if (pendingId) return;
    setPendingId(book.id);
    setError(null);
    try {
      await onPick(book);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPendingId(null);
    }
  }

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
          {books.kind === "ready" && books.books.length > 0 ? (
            <ul
              aria-label="Your books"
              aria-describedby={error ? errorId : undefined}
              className="m-0 flex max-h-72 list-none flex-col overflow-y-auto p-0"
            >
              {books.books.map((b) => (
                <li key={b.id} className="border-b border-rule-soft">
                  <button
                    type="button"
                    onClick={() => pick(b)}
                    disabled={pendingId !== null}
                    className="flex w-full flex-col items-start gap-0.5 rounded-sm py-2 text-left transition-colors hover:bg-edge disabled:opacity-40 [transition-duration:var(--leaf-dur-ui)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
                  >
                    <span className={labelClass}>{b.title}</span>
                    {b.author ? <span className={bodyClass}>{b.author}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {error ? (
            <p id={errorId} role="alert" className={errorClass}>
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
