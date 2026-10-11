"use client";

import { useId, useState } from "react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
} from "@/components/primitives";
import { errorClass } from "./styles";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  /** Resolves on success; throw an Error to show its message in the dialog. */
  onConfirm: () => Promise<void>;
}

/** Asks before a destructive action. Nothing happens until Confirm is pressed. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: ConfirmDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const errorId = useId();

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setError(null);
      setPending(false);
    }
  }

  async function handleConfirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
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
        title={title}
        description={description}
      >
        <div className="flex flex-col gap-4">
          {error ? (
            <p id={errorId} role="alert" className={errorClass}>
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="primary" onClick={handleConfirm} disabled={pending}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
