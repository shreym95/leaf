"use client";

import { useState } from "react";
import { Button } from "@/components/primitives";
import type { NoteGroup } from "./readModel";
import { bodyClass, errorClass, labelClass } from "./styles";

const DELETE_ERROR = "Couldn't delete. Try again.";

const tagClass =
  "font-mono uppercase text-faint [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-label)]";

export interface NotesListProps {
  /** Notes by chapter, in outline order. Empty when there are none. */
  groups: NoteGroup[];
  /** Deletes one of the viewer's own items. Resolves on success; throws to show its message. */
  onDelete: (id: string) => Promise<void>;
}

/**
 * Marks, highlights and notes per chapter. The viewer's own items get a Delete action;
 * for a shared highlight it is "Remove from group", which deletes only the group copy.
 */
export function NotesList({ groups, onDelete }: NotesListProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onDelete(id);
    } catch {
      // The database's own text is not shown to readers; one plain line is enough.
      setError(DELETE_ERROR);
    } finally {
      setPending(false);
    }
  }

  if (groups.length === 0) {
    return <p className={bodyClass}>No marks or notes yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.chapterIndex} className="flex flex-col">
          <h3 className={`${labelClass} pb-1`}>{group.label}</h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {group.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b border-rule-soft py-2"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className={tagClass}>{item.name}</span>
                  {item.kind === "highlight" && item.quote !== null ? (
                    <span className={`${labelClass} line-clamp-2 break-words`}>
                      {item.quote}
                    </span>
                  ) : null}
                  {item.kind === "mark" ? (
                    <span className={`${labelClass} break-words`}>marked this page</span>
                  ) : null}
                  {item.text !== null ? (
                    <span className={`${labelClass} break-words whitespace-pre-wrap`}>
                      {item.text}
                    </span>
                  ) : null}
                </div>
                {item.isSelf ? (
                  item.kind === "highlight" ? (
                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={pending}
                      aria-label={`Remove from group: your highlight in ${group.label}`}
                      onClick={() => remove(item.id)}
                    >
                      Remove from group
                    </Button>
                  ) : (
                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={pending}
                      aria-label={`Delete your ${item.kind === "note" ? "note" : "mark"} in ${group.label}`}
                      onClick={() => remove(item.id)}
                    >
                      Delete
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
