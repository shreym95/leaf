"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Button,
} from "@/components/primitives";

/**
 * DeleteAccountDialog — the irreversible "Delete account" flow (SPEC §9 M4).
 * Presentational + token-driven; the only logic here is the confirm-word gate
 * and the POST to /api/account/delete.
 *
 * a11y: a real Radix Dialog (focus trap, Esc-to-close), the confirm input has a
 * visible <label>, the destructive action is clearly worded, everything is
 * keyboard reachable. The confirm button stays disabled until the user types
 * DELETE exactly.
 */

const CONFIRM_WORD = "DELETE";

const WHAT_IS_DELETED = [
  "Every book in your library and the EPUB files you uploaded",
  "All of your highlights and notes",
  "Your reading positions and reading settings",
  "Your Leaf account and sign-in",
];

export function DeleteAccountDialog() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const listId = useId();
  const router = useRouter();

  const canConfirm = confirmText === CONFIRM_WORD && !submitting;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setConfirmText("");
      setError(null);
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: CONFIRM_WORD }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(
          body?.error ?? "Could not delete your account. Please try again.",
        );
        setSubmitting(false);
        return;
      }
      // Account is gone — leave settings and drop any cached per-user state.
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="primary">Delete account…</Button>
      </DialogTrigger>
      <DialogContent
        title="Delete your account?"
        description="This is permanent. It cannot be undone, and nothing can be recovered afterwards."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)]">
              This will permanently remove:
            </p>
            <ul
              id={listId}
              className="flex list-disc flex-col gap-1 pl-5 font-ui text-ink [font-size:var(--leaf-text-sm)] [line-height:var(--leaf-leading-body)]"
            >
              {WHAT_IS_DELETED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor={inputId}
              className="font-ui text-ink [font-size:var(--leaf-text-sm)]"
            >
              Type <span className="font-mono text-accent">{CONFIRM_WORD}</span>{" "}
              to confirm
            </label>
            <input
              id={inputId}
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              aria-describedby={listId}
              className="h-10 rounded-sm border border-rule bg-paper px-3 font-mono text-ink [font-size:var(--leaf-text-sm)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="font-ui text-accent [font-size:var(--leaf-text-sm)]"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-1 flex justify-end gap-3">
            <DialogClose asChild>
              <Button variant="ghost">Keep my account</Button>
            </DialogClose>
            <Button
              variant="primary"
              onClick={handleDelete}
              disabled={!canConfirm}
              aria-disabled={!canConfirm}
            >
              {submitting ? "Deleting…" : "Permanently delete"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
