"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
} from "@/components/primitives";
import { titlesMatch } from "@/lib/groups/copy-match";
import { bodyClass, errorClass, labelClass } from "./styles";

/** Below this alignment confidence the copy's chapters are said not to match. */
export const LOW_CONFIDENCE = 0.6;

export type CopyPanelState =
  | {
      kind: "have";
      bookId: string;
      confidence: number | null;
      title: string | null;
      /** The group read's title, to compare with the linked copy's title. */
      readTitle: string;
    }
  | { kind: "catalog" }
  | { kind: "upload" };

export interface CopyPanelProps {
  state: CopyPanelState;
  pending: boolean;
  /** Set once a copy was added in this visit and the page is catching up. */
  added: boolean;
  error: string | null;
  onAddCatalog: () => void;
  onChoose: () => void;
  /** Open the picker to replace the linked copy. Only shown when a copy exists. */
  onChange: () => void;
  /** Open the remove confirmation. Only shown when a copy exists. */
  onRemove: () => void;
}

export function CopyPanel({
  state,
  pending,
  added,
  error,
  onAddCatalog,
  onChoose,
  onChange,
  onRemove,
}: CopyPanelProps) {
  return (
    <div className="flex flex-col items-start gap-3">
      {state.kind === "have" ? (
        <>
          {state.title ? (
            <p className={labelClass}>{`Linked: ${state.title}`}</p>
          ) : null}
          {state.title && !titlesMatch(state.title, state.readTitle) ? (
            <p role="note" className={bodyClass}>
              This doesn&rsquo;t look like <em>{state.readTitle}</em>. If it&rsquo;s the
              wrong book, use Change copy.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild>
              <Link href={`/reader/${state.bookId}`}>Open book</Link>
            </Button>
            <Button variant="quiet" size="sm" onClick={onChange} disabled={pending}>
              Change copy
            </Button>
            <Button variant="quiet" size="sm" onClick={onRemove} disabled={pending}>
              Remove copy
            </Button>
          </div>
          {state.confidence !== null && state.confidence < LOW_CONFIDENCE ? (
            <p className={bodyClass}>
              Your copy&rsquo;s chapters don&rsquo;t fully match. Progress may be
              approximate.
            </p>
          ) : null}
        </>
      ) : (
        <>
          {state.kind === "catalog" ? (
            <Button onClick={onAddCatalog} disabled={pending}>
              Add to my library
            </Button>
          ) : (
            <Button onClick={onChoose} disabled={pending}>
              Choose your copy
            </Button>
          )}
          <p className={bodyClass}>Each member uses their own copy.</p>
        </>
      )}
      <p role="status" className={bodyClass}>
        {added && state.kind !== "have" ? "Added." : ""}
      </p>
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface RemoveCopyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Unlinks the copy; when `deleteBook` is true, also deletes the book from the
   * library. Resolves on success; throw an Error to show its message in the dialog.
   */
  onConfirm: (deleteBook: boolean) => Promise<void>;
}

/**
 * Confirms removing the caller's copy. The "also delete" box is off by default and
 * resets whenever the dialog closes.
 */
export function RemoveCopyDialog({
  open,
  onOpenChange,
  onConfirm,
}: RemoveCopyDialogProps) {
  const [deleteBook, setDeleteBook] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const checkboxId = useId();
  const helperId = useId();
  const errorId = useId();

  function handleOpenChange(next: boolean) {
    // A remove in flight owns the dialog: Esc, overlay and Cancel do nothing until it settles.
    if (!next && pending) return;
    onOpenChange(next);
    if (!next) {
      setDeleteBook(false);
      setError(null);
      setPending(false);
    }
  }

  async function handleConfirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(deleteBook);
      setDeleteBook(false);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        title="Remove your copy?"
        description="Your place in the group is kept. You can add a copy again later."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor={checkboxId} className="flex items-center gap-3">
              <input
                id={checkboxId}
                type="checkbox"
                checked={deleteBook}
                disabled={pending}
                onChange={(e) => setDeleteBook(e.target.checked)}
                aria-describedby={helperId}
                className="size-4 cursor-pointer [accent-color:var(--leaf-accent)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
              />
              <span className={labelClass}>Also delete this book from my library</span>
            </label>
            <p id={helperId} className={`pl-7 ${bodyClass}`}>
              {"Deletes the file and your highlights in it, and removes it from any other group it's linked to."}
            </p>
          </div>
          {pending ? (
            <p role="status" className={bodyClass}>
              Removing…
            </p>
          ) : null}
          {error ? (
            <p id={errorId} role="alert" className={errorClass}>
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <DialogClose asChild>
              <Button variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant="primary" onClick={handleConfirm} disabled={pending}>
              Remove
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
