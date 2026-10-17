"use client";

import { useId, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
} from "@/components/primitives";
import {
  SCHEDULE_MAX,
  validateSchedule,
  type ScheduleCheckpoint,
} from "@/lib/groups/schedule";
import type { Outline } from "@/lib/groups/types";
import { setReadSchedule } from "./actions";
import { bodyClass, errorClass, inputClass, labelClass } from "./styles";

const SAVE_ERROR = "Couldn't save. Try again.";

interface Row {
  key: number;
  /** Outline chapter index as text, or "" until one is chosen. */
  chapter: string;
  /** `YYYY-MM-DD`, or "" until a date is entered. */
  dueOn: string;
}

export interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  readId: string;
  outline: Outline;
  /** The saved schedule, or null when none is set. */
  schedule: ScheduleCheckpoint[] | null;
  /** Called after a successful save or clear, before the dialog closes. */
  onSaved: () => void;
}

/** Owner or creator only: set, edit or clear a read's checkpoints. */
export function ScheduleDialog(props: ScheduleDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        title="Reading schedule"
        description="Checkpoints in chapter order, each with a date. Members see them on the read page."
      >
        <ScheduleForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted inside the dialog content, so its rows reset each time the dialog opens. */
function ScheduleForm({
  onOpenChange,
  groupId,
  readId,
  outline,
  schedule,
  onSaved,
}: ScheduleDialogProps) {
  const [rows, setRows] = useState<Row[]>(() =>
    (schedule ?? []).map((c, i) => ({
      key: i,
      chapter: String(c.chapter_index),
      dueOn: c.due_on,
    })),
  );
  const nextKey = useRef(rows.length);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  function update(key: number, patch: Partial<Pick<Row, "chapter" | "dueOn">>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function add() {
    if (rows.length >= SCHEDULE_MAX) return;
    setRows((rs) => [...rs, { key: nextKey.current++, chapter: "", dueOn: "" }]);
  }

  function remove(key: number) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  async function send(next: ScheduleCheckpoint[] | null) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await setReadSchedule(groupId, readId, next);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : SAVE_ERROR);
    } finally {
      setPending(false);
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (rows.some((r) => r.chapter === "" || r.dueOn === "")) {
      setError("Each checkpoint needs a chapter and a date.");
      return;
    }
    const checked = validateSchedule(
      rows.map((r) => ({ chapter_index: Number(r.chapter), due_on: r.dueOn })),
      outline.length,
    );
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    void send(checked.schedule);
  }

  return (
    <form onSubmit={handleSave} noValidate className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <p className={bodyClass}>No checkpoints. Saving with none clears the schedule.</p>
      ) : (
        <>
          <div aria-hidden="true" className="flex gap-2">
            <span className={`${labelClass} min-w-0 flex-1`}>Chapter</span>
            <span className={labelClass}>Due by</span>
          </div>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((row, i) => (
              <li key={row.key} className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`Chapter for checkpoint ${i + 1}`}
                  value={row.chapter}
                  onChange={(e) => update(row.key, { chapter: e.target.value })}
                  className={`${inputClass} min-w-0 max-w-full flex-1`}
                >
                  <option value="" disabled>
                    Choose a chapter
                  </option>
                  {outline.map((entry) => (
                    <option key={entry.index} value={String(entry.index)}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  aria-label={`Due date for checkpoint ${i + 1}`}
                  value={row.dueOn}
                  onChange={(e) => update(row.key, { dueOn: e.target.value })}
                  className={inputClass}
                />
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  aria-label={`Remove checkpoint ${i + 1}`}
                  onClick={() => remove(row.key)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ol>
        </>
      )}

      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={add}
          disabled={rows.length >= SCHEDULE_MAX || pending}
        >
          Add checkpoint
        </Button>
        {rows.length >= SCHEDULE_MAX ? (
          <p className={`${bodyClass} pt-2`}>Up to {SCHEDULE_MAX} checkpoints.</p>
        ) : null}
      </div>

      {error ? (
        <p id={errorId} role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {schedule ? (
          <Button
            type="button"
            variant="quiet"
            size="sm"
            disabled={pending}
            onClick={() => void send(null)}
          >
            Clear schedule
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-3">
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" variant="primary" disabled={pending}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}
