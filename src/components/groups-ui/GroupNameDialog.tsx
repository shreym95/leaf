"use client";

import { useId, useState } from "react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
} from "@/components/primitives";
import { errorClass, inputClass, labelClass } from "./styles";

export const GROUP_NAME_MAX = 60;

export interface GroupNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initialName?: string;
  /** Resolves on success; throw an Error to show its message in the dialog. */
  onSubmit: (name: string) => Promise<void>;
}

/** Name form shared by "New group" and "Rename". Validates 1 to 60 characters. */
export function GroupNameDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initialName = "",
  onSubmit,
}: GroupNameDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputId = useId();
  const errorId = useId();

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setName(initialName);
      setError(null);
      setPending(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > GROUP_NAME_MAX) {
      setError(`Enter a name of 1 to ${GROUP_NAME_MAX} characters.`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent title={title} aria-describedby={undefined}>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className={labelClass}>
              Name
            </label>
            <input
              id={inputId}
              type="text"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={inputClass}
            />
          </div>
          {error ? (
            <p id={errorId} role="alert" className={errorClass}>
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={pending}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
