"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuSeparator,
  Dialog,
  DialogContent,
  DialogClose,
  Button,
} from "@/components/primitives";

/**
 * BookActions — hide / restore / delete for one book.
 *
 * A sibling of the card's link, never inside it: the whole card is one
 * focusable link to the reader, and nesting a menu button in an anchor is
 * invalid markup and unusable by keyboard.
 *
 * Deleting asks first and says exactly what goes, because it takes the file,
 * the highlights and the reading position with it. Hiding does not ask — it is
 * reversible, and a confirmation on a reversible action is just friction.
 */

export interface BookActionsProps {
  bookId: string;
  title: string;
  archived: boolean;
}

export function BookActions({ bookId, title, archived }: BookActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "PATCH" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "That didn't work.");
      }
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${title}`}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-pill text-ink-mid transition-colors hover:bg-page hover:text-ink [transition-duration:var(--leaf-dur-ui)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4"
            >
              <circle cx="12" cy="5" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="12" cy="19" r="1.6" />
            </svg>
          </button>
        </MenuTrigger>

        <MenuContent align="end">
          <MenuItem onSelect={() => void send("PATCH", { archived: !archived })}>
            {archived ? "Show on shelf" : "Hide from shelf"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => setConfirming(true)}>Delete…</MenuItem>
        </MenuContent>
      </Menu>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          title={`Delete ${title}?`}
          description="This removes the book file, your highlights and notes for it, and where you had read up to. It cannot be undone. To just clear it off the shelf, hide it instead."
        >
          {error && (
            <p
              role="alert"
              className="mb-3 font-ui text-accent [font-size:var(--leaf-text-sm)]"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="quiet" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void send("DELETE")}
            >
              {busy ? "Deleting…" : "Delete for good"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {error && !confirming && (
        <p
          role="alert"
          className="font-ui text-accent [font-size:var(--leaf-text-xs)]"
        >
          {error}
        </p>
      )}
    </>
  );
}
