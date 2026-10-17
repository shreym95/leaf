"use client";

import { ConfirmDialog } from "./ConfirmDialog";

export interface RemoveReadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves on success; throw an Error to show its message in the dialog. */
  onConfirm: () => Promise<void>;
}

/** Confirms removing a book (a group read) from its group. */
export function RemoveReadDialog({
  open,
  onOpenChange,
  onConfirm,
}: RemoveReadDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Remove this book from the group?"
      description="Everyone's progress and milestones for it will be deleted. Your own copy stays in your library."
      confirmLabel="Remove"
      onConfirm={onConfirm}
    />
  );
}
